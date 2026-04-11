import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatApi } from "@/api/index.ts";
import { e2eeService, WAITING_FOR_SENDER_KEY } from "@/services/e2eeService.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import { useE2eeStore } from "@/stores/e2eeStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import type { GetUserRoomsResponse, RoomSummary } from "@/types/chat.ts";
import type { SenderKeyState } from "@/types/e2ee.ts";
import { chatRoomService, LATEST_MESSAGE_FALLBACK } from "./chatRoomService.ts";

vi.mock("@/api/index.ts", () => ({
    chatApi: {
        getRooms: vi.fn(),
        getMyRoomInvitation: vi.fn(),
        getRoomDetail: vi.fn(),
    },
}));

vi.mock("@/services/e2eeService.ts", () => ({
    WAITING_FOR_SENDER_KEY: "WAITING_FOR_SENDER_KEY",
    e2eeService: {
        decryptMessage: vi.fn(),
        resolveDirectKey: vi.fn(),
        reconcileRoomSenderKeys: vi.fn(),
        isDirectRoomReadyFromState: vi.fn(),
    },
}));

vi.mock("@/utils/logger.ts", () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
    },
}));

const emptyRooms = (): GetUserRoomsResponse => ({
    direct: [],
    group: [],
    channel: [],
    bot: [],
});

const room = (overrides: Partial<RoomSummary>): RoomSummary => ({
    room_id: 1,
    room_type: "direct",
    display_name: "Mina Park",
    avatar_url: "avatars/mina.png",
    latest_message: undefined,
    latest_message_sender_id: undefined,
    unread_count: 0,
    ...overrides,
});

const resetChatStore = () => {
    useChatStore.setState({
        rooms: { direct: [], group: [], channel: [], bot: [] },
        currentRoomId: null,
        currentRoomDetail: null,
        messages: {},
        hasMore: {},
        loadingRooms: false,
        loadingMessages: false,
        pendingInvitation: null,
        directKeyStatus: {},
    });
};

const resetUserStore = () => {
    useUserStore.setState({
        currentUser: { id: 1, accountId: 77, name: "Hiro" },
        recordedUsers: new Map(),
        participantId: 301,
    });
};

const resetE2eeStore = () => {
    useE2eeStore.setState({
        keysUploaded: false,
        otpKeyCount: 0,
        otpKeyTargetCount: 0,
        otpReplenishThreshold: 0,
        bootstrapStatus: "ready",
        bootstrapError: null,
        senderKeyRequests: new Set(),
    });
};

describe("chatRoomService.loadRooms latest message summaries", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetChatStore();
        resetUserStore();
        resetE2eeStore();
        vi.mocked(chatApi.getMyRoomInvitation).mockResolvedValue({ found: false });
        vi.mocked(chatApi.getRoomDetail).mockResolvedValue({
            room_id: 21,
            room_type: "direct",
            name: "Mina Park",
            members: [
                {
                    member_id: 401,
                    participant_id: 301,
                    user_id: 1,
                    display_name: "Hiro",
                    role: "owner",
                    joined_at: "2026-01-01T00:00:00Z",
                },
                {
                    member_id: 402,
                    participant_id: 302,
                    user_id: 2,
                    display_name: "Mina Park",
                    role: "owner",
                    joined_at: "2026-01-01T00:00:00Z",
                },
            ],
            messages: [],
        });
        vi.mocked(e2eeService.resolveDirectKey).mockResolvedValue(true);
        vi.mocked(e2eeService.isDirectRoomReadyFromState).mockImplementation((status, localStates, options) => {
            const ownState = localStates.get(options.currentMemberId);
            const peerMembers = (options.roomMembers ?? []).filter((member) => member.member_id !== options.currentMemberId);
            return status.own_sender_key_exists
                && ownState?.is_own_key === true
                && status.pending_from_members.length === 0
                && status.available_from_member_ids.length === 0
                && peerMembers.every((member) => localStates.get(member.member_id)?.is_own_key === false);
        });
        const localStates = new Map<number, SenderKeyState>([
            [401, {
                member_id: "401",
                is_own_key: true,
                sender_key_version: 1775758701055,
                updated_at: 1,
            }],
            [402, {
                member_id: "402",
                is_own_key: false,
                sender_key_version: 1775758701055,
                updated_at: 2,
            }],
        ]);
        vi.mocked(e2eeService.reconcileRoomSenderKeys).mockResolvedValue({
            currentMemberId: 401,
            status: {
                own_sender_key_exists: true,
                requestable_member_ids: [],
                available_from_member_ids: [],
                available_to_member_ids: [],
                pending_receivers: [],
                pending_from_members: [],
            },
            localStates,
        });
    });

    it("decrypts room summary latest messages with the sender member id and keeps plaintext summaries", async () => {
        vi.mocked(chatApi.getRooms).mockResolvedValue({
            ...emptyRooms(),
            direct: [
                room({
                    room_id: 7,
                    latest_message: "e2ee:v1:encrypted",
                    latest_message_sender_id: 101,
                }),
            ],
            channel: [
                room({
                    room_id: 10,
                    room_type: "channel",
                    display_name: "Announcements",
                    latest_message: "Plain broadcast",
                    latest_message_sender_id: 303,
                }),
            ],
        });
        vi.mocked(e2eeService.decryptMessage).mockImplementation(async (content) => (
            content === "e2ee:v1:encrypted" ? "Hello Mina" : content
        ));

        await chatRoomService.loadRooms();

        expect(e2eeService.decryptMessage).toHaveBeenCalledWith("e2ee:v1:encrypted", 101, 7);
        expect(useChatStore.getState().rooms.direct[0]).toMatchObject({
            latest_message: "Hello Mina",
            latest_message_sender_id: 101,
        });
        expect(useChatStore.getState().rooms.channel[0].latest_message).toBe("Plain broadcast");
    });

    it("uses a neutral fallback when the latest message cannot be decrypted", async () => {
        vi.mocked(chatApi.getRooms).mockResolvedValue({
            ...emptyRooms(),
            direct: [
                room({
                    room_id: 8,
                    latest_message: "e2ee:v1:missing-sender",
                    latest_message_sender_id: undefined,
                }),
            ],
            group: [
                room({
                    room_id: 9,
                    room_type: "group",
                    display_name: "Team",
                    latest_message: "e2ee:v1:waiting",
                    latest_message_sender_id: 202,
                }),
            ],
        });
        vi.mocked(e2eeService.decryptMessage).mockResolvedValue(WAITING_FOR_SENDER_KEY);

        await chatRoomService.loadRooms();

        expect(e2eeService.decryptMessage).toHaveBeenCalledTimes(1);
        expect(e2eeService.decryptMessage).toHaveBeenCalledWith("e2ee:v1:waiting", 202, 9);
        expect(useChatStore.getState().rooms.direct[0].latest_message).toBe(LATEST_MESSAGE_FALLBACK);
        expect(useChatStore.getState().rooms.group[0].latest_message).toBe(LATEST_MESSAGE_FALLBACK);
    });

    it("normalizes deleted rooms without decrypting or keeping the avatar", async () => {
        vi.mocked(chatApi.getRooms).mockResolvedValue({
            ...emptyRooms(),
            direct: [
                room({
                    room_id: 11,
                    status: "deleted",
                    display_name: "Old Contact",
                    avatar_url: "avatars/old.png",
                    latest_message: "e2ee:v1:old",
                    latest_message_sender_id: 101,
                    unread_count: 9,
                }),
            ],
        });

        await chatRoomService.loadRooms();

        expect(e2eeService.decryptMessage).not.toHaveBeenCalled();
        expect(useChatStore.getState().rooms.direct[0]).toMatchObject({
            status: "deleted",
            display_name: "Deleted Contact",
            avatar_url: undefined,
            unread_count: 0,
        });
    });

    it("marks an in-memory room and current room detail as deleted", () => {
        useChatStore.getState().setRooms({
            direct: [room({ room_id: 12, display_name: "Luna", avatar_url: "avatars/luna.png", unread_count: 4 })],
            group: [],
            channel: [],
            bot: [],
        });
        useChatStore.getState().setRoomDetail({
            room_id: 12,
            room_type: "direct",
            name: "Luna",
            avatar_url: "avatars/luna.png",
            members: [],
            messages: [],
        });

        chatRoomService.markRoomDeleted(12);

        expect(useChatStore.getState().rooms.direct[0]).toMatchObject({
            status: "deleted",
            display_name: "Deleted Contact",
            avatar_url: undefined,
            unread_count: 0,
        });
        expect(useChatStore.getState().currentRoomDetail).toMatchObject({
            status: "deleted",
            name: "Deleted Contact",
            avatar_url: undefined,
        });
    });

    it("deduplicates concurrent room detail fetches and hydrates initial messages from detail", async () => {
        const detail = {
            room_id: 33,
            room_type: "direct" as const,
            name: "Bell",
            members: [],
            messages: Array.from({ length: 20 }, (_, index) => ({
                message_id: index + 1,
                sender_id: 402,
                type: "text" as const,
                content: `cipher-${index + 1}`,
                is_edited: false,
                created_at: "2026-01-01T00:00:00Z",
            })),
        };
        let resolveDetail: ((value: typeof detail) => void) | undefined;
        vi.mocked(chatApi.getRoomDetail).mockImplementation(() => new Promise((resolve) => {
            resolveDetail = resolve;
        }));
        vi.mocked(e2eeService.decryptMessage).mockImplementation(async (content: string) => `plain:${content}`);

        const hydrated = chatRoomService.loadRoomDetail(33, { persist: true, hydrateMessages: true });
        const nonPersistent = chatRoomService.loadRoomDetail(33, { persist: false });

        expect(chatApi.getRoomDetail).toHaveBeenCalledTimes(1);

        resolveDetail?.(detail);
        await expect(Promise.all([hydrated, nonPersistent])).resolves.toEqual([detail, detail]);

        expect(chatApi.getRoomDetail).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().currentRoomDetail).toEqual(detail);
        expect(useChatStore.getState().messages[33]).toHaveLength(20);
        expect(useChatStore.getState().messages[33][0].content).toBe("plain:cipher-1");
        expect(useChatStore.getState().hasMore[33]).toBe(true);
    });

    it("deduplicates concurrent direct-room preparation for the same room", async () => {
        useChatStore.getState().setRooms({
            direct: [room({ room_id: 21, display_name: "Mina Park" })],
            group: [],
            channel: [],
            bot: [],
        });

        const first = chatRoomService.prepareDirectRoom(21);
        const second = chatRoomService.prepareDirectRoom(21);

        await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);

        expect(chatApi.getMyRoomInvitation).toHaveBeenCalledTimes(1);
        expect(chatApi.getRoomDetail).toHaveBeenCalledTimes(1);
        expect(e2eeService.reconcileRoomSenderKeys).toHaveBeenCalledTimes(1);
        expect(e2eeService.resolveDirectKey).not.toHaveBeenCalled();
        expect(useChatStore.getState().directKeyStatus[21]).toBe("unlocked");
    });
});
