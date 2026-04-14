import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatApi } from "@/api/index.ts";
import {
    chatGetRoomSnapshot,
    chatMarkRoomRead,
    chatRetryMessage,
    chatSendMessage,
    chatSetActiveRoom,
    type ChatRoomSnapshot,
    type ChatRoomsSnapshot,
} from "@/bridge/chat.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { chatRoomService } from "./chatRoomService.ts";
import { chatService } from "./chatService.ts";

vi.mock("@/api/index.ts", () => ({
    chatApi: {
        createRoom: vi.fn(),
        joinRoom: vi.fn(),
        respondInvitation: vi.fn(),
    },
}));

vi.mock("@/bridge/chat.ts", () => ({
    chatGetRoomSnapshot: vi.fn(),
    chatMarkRoomRead: vi.fn(),
    chatRetryMessage: vi.fn(),
    chatSendMessage: vi.fn(),
    chatSetActiveRoom: vi.fn(),
}));

vi.mock("./chatService.ts", () => ({
    chatService: {
        ensureRuntimeReady: vi.fn(),
        refreshRooms: vi.fn(),
        hydrateRoomSnapshot: vi.fn(),
    },
}));

vi.mock("@/utils/logger.ts", () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
    },
}));

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
        syncState: null,
        runtimeStatus: "idle",
        runtimeError: null,
    });
};

const resetUserStore = () => {
    useUserStore.setState({
        currentUser: { id: 1, accountId: 77, name: "Hiro" },
        recordedUsers: new Map(),
        participantId: 301,
    });
};

const roomsSnapshot = (): ChatRoomsSnapshot => ({
    participant_id: 301,
    rooms: {
        direct: [{
            room_id: 21,
            room_type: "direct",
            display_name: "Mina Park",
            latest_message: "Hello",
            latest_message_created_at: "2026-04-12T02:00:00Z",
            latest_message_sender_id: 401,
            unread_count: 2,
            direct_key_status: "unlocked",
        }],
        group: [],
        channel: [],
        bot: [],
    },
    sync_state: {
        ws_status: "connected",
        pending_business_jobs: 0,
        pending_sync_jobs: 0,
        self_sender_key_sync_status: "idle",
    },
});

const roomSnapshot = (overrides: Partial<ChatRoomSnapshot> = {}): ChatRoomSnapshot => ({
    room_id: 21,
    room_type: "direct",
    name: "Mina Park",
    description: undefined,
    avatar_url: "avatars/mina.png",
    blocked_by_peer: false,
    blocked_by_me: false,
    status: "active",
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
            role: "member",
            joined_at: "2026-01-01T00:00:00Z",
        },
    ],
    messages: [{
        client_message_id: "server-9001",
        message_id: 9001,
        sender_id: 402,
        sender_device_id: "device-peer-1",
        sender_key_version: 1776090000000,
        type: "text",
        content: "hello",
        is_edited: false,
        is_deleted: false,
        created_at: "2026-04-12T02:00:00Z",
        sort_key: Date.parse("2026-04-12T02:00:00Z"),
        delivery_status: "sent",
        is_local_echo: false,
    }],
    has_more: false,
    pending_invitation: null,
    direct_key_status: "unlocked",
    member_count: 2,
    ...overrides,
});

describe("chatRoomService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetChatStore();
        resetUserStore();
        (chatRoomService as unknown as {
            loadRoomsPromise: Promise<void> | null;
            roomDetailFetchPromises: Map<string, Promise<ChatRoomSnapshot | null>>;
        }).loadRoomsPromise = null;
        (chatRoomService as unknown as {
            loadRoomsPromise: Promise<void> | null;
            roomDetailFetchPromises: Map<string, Promise<ChatRoomSnapshot | null>>;
        }).roomDetailFetchPromises = new Map();

        vi.mocked(chatService.refreshRooms).mockImplementation(async () => {
            useChatStore.getState().setRooms(roomsSnapshot().rooms);
            useChatStore.getState().setSyncState(roomsSnapshot().sync_state);
            useChatStore.getState().setRuntimeStatus("ready");
            useUserStore.getState().setParticipantId(301);
            return roomsSnapshot();
        });
        vi.mocked(chatService.ensureRuntimeReady).mockResolvedValue(undefined);
        vi.mocked(chatMarkRoomRead).mockResolvedValue(undefined);
        vi.mocked(chatSetActiveRoom).mockResolvedValue(undefined);

        vi.mocked(chatService.hydrateRoomSnapshot).mockImplementation((snapshot, options) => {
            if (options?.persistDetail !== false) {
                useChatStore.getState().setRoomDetail(snapshot);
            }
            if (options?.replaceMessages === false) {
                useChatStore.getState().prependMessages(snapshot.room_id, snapshot.messages, snapshot.has_more);
            } else {
                useChatStore.getState().setMessages(snapshot.room_id, snapshot.messages, snapshot.has_more);
            }
            useChatStore.getState().setDirectKeyStatus(snapshot.room_id, snapshot.direct_key_status);
        });
    });

    it("deduplicates concurrent room summary loads through the Rust runtime bridge", async () => {
        let resolveRefresh: ((value: ChatRoomsSnapshot) => void) | undefined;
        vi.mocked(chatService.refreshRooms).mockImplementationOnce(() => new Promise((resolve) => {
            resolveRefresh = resolve;
        }));

        const first = chatRoomService.loadRooms();
        const second = chatRoomService.loadRooms();

        expect(chatService.refreshRooms).toHaveBeenCalledTimes(1);

        resolveRefresh?.(roomsSnapshot());
        await Promise.all([first, second]);
        expect(chatService.refreshRooms).toHaveBeenCalledTimes(1);
    });

    it("hydrates room detail and messages from the Rust room snapshot", async () => {
        vi.mocked(chatGetRoomSnapshot).mockResolvedValue(roomSnapshot());

        const detail = await chatRoomService.loadRoomDetail(21, { persist: true, hydrateMessages: true });

        expect(chatGetRoomSnapshot).toHaveBeenCalledWith({ room_id: 21 });
        expect(chatService.hydrateRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ room_id: 21 }), {
            persistDetail: true,
            replaceMessages: true,
        });
        expect(detail.room_id).toBe(21);
        expect(useChatStore.getState().currentRoomDetail?.room_id).toBe(21);
        expect(useChatStore.getState().messages[21][0]?.message_id).toBe(9001);
    });

    it("prepends older messages when paginating from the local decrypted table", async () => {
        useChatStore.getState().setMessages(21, [{
            client_message_id: "server-9002",
            message_id: 9002,
            sender_id: 402,
            sender_device_id: "device-peer-1",
            sender_key_version: 1776090000001,
            type: "text",
            content: "newer",
            is_edited: false,
            is_deleted: false,
            created_at: "2026-04-12T03:00:00Z",
            sort_key: Date.parse("2026-04-12T03:00:00Z"),
            delivery_status: "sent",
            is_local_echo: false,
        }], false);
        vi.mocked(chatGetRoomSnapshot).mockResolvedValue(roomSnapshot({
            messages: [{
                client_message_id: "server-9000",
                message_id: 9000,
                sender_id: 402,
                sender_device_id: "device-peer-1",
                sender_key_version: 1776090000002,
                type: "text",
                content: "older",
                is_edited: false,
                is_deleted: false,
                created_at: "2026-04-12T01:00:00Z",
                sort_key: Date.parse("2026-04-12T01:00:00Z"),
                delivery_status: "sent",
                is_local_echo: false,
            }],
            has_more: true,
        }));

        await chatRoomService.loadMessages(21, Date.parse("2026-04-12T03:00:00Z"));

        expect(chatGetRoomSnapshot).toHaveBeenCalledWith({
            room_id: 21,
            before_sort_key: Date.parse("2026-04-12T03:00:00Z"),
        });
        expect(chatService.hydrateRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ room_id: 21 }), {
            persistDetail: false,
            replaceMessages: false,
        });
        expect(useChatStore.getState().messages[21].map((message) => message.message_id)).toEqual([9000, 9002]);
    });

    it("creates a local pending message through the Rust runtime bridge", async () => {
        vi.mocked(chatSendMessage).mockResolvedValue({
            client_message_id: "local-1",
            message_id: null,
            sender_id: 401,
            sender_device_id: "device-1",
            sender_key_version: 1776090000003,
            type: "text",
            content: "hello world",
            is_edited: false,
            is_deleted: false,
            created_at: "2026-04-12T04:00:00Z",
            sort_key: Date.parse("2026-04-12T04:00:00Z"),
            delivery_status: "pending",
            is_local_echo: true,
        });

        await chatRoomService.sendMessage(21, "hello world");

        expect(chatSendMessage).toHaveBeenCalledWith({
            room_id: 21,
            content: "hello world",
            type: "text",
        });
        expect(useChatStore.getState().messages[21][0]).toMatchObject({
            client_message_id: "local-1",
            delivery_status: "pending",
            content: "hello world",
        });
    });

    it("marks a room as read optimistically before delegating to the Rust runtime", async () => {
        useChatStore.setState({
            rooms: {
                direct: [{
                    room_id: 21,
                    room_type: "direct",
                    display_name: "Mina Park",
                    unread_count: 4,
                }],
                group: [],
                channel: [],
                bot: [],
            },
        });
        vi.mocked(chatMarkRoomRead).mockResolvedValue(undefined);

        await chatRoomService.markAsRead(21);

        expect(useChatStore.getState().rooms.direct[0]?.unread_count).toBe(0);
        expect(chatMarkRoomRead).toHaveBeenCalledWith(21);
    });

    it("retries a failed message through the runtime delivery queue", async () => {
        useChatStore.setState({
            messages: {
                21: [{
                    client_message_id: "local-2",
                    message_id: null,
                    sender_id: 401,
                    sender_device_id: "device-1",
                    sender_key_version: 1776090000004,
                    type: "text",
                    content: "retry me",
                    is_edited: false,
                    is_deleted: false,
                    created_at: "2026-04-12T04:10:00Z",
                    sort_key: Date.parse("2026-04-12T04:10:00Z"),
                    delivery_status: "failed",
                    delivery_error: "network error",
                    is_local_echo: true,
                }],
            },
        });
        vi.mocked(chatRetryMessage).mockResolvedValue({
            client_message_id: "local-2",
            message_id: null,
            sender_id: 401,
            sender_device_id: "device-1",
            sender_key_version: 1776090000004,
            type: "text",
            content: "retry me",
            is_edited: false,
            is_deleted: false,
            created_at: "2026-04-12T04:10:00Z",
            sort_key: Date.parse("2026-04-12T04:10:00Z"),
            delivery_status: "pending",
            is_local_echo: true,
        });

        await chatRoomService.retryMessage(21, "local-2");

        expect(chatRetryMessage).toHaveBeenCalledWith({ client_message_id: "local-2" });
        expect(useChatStore.getState().messages[21][0]).toMatchObject({
            client_message_id: "local-2",
            delivery_status: "pending",
        });
    });

    it("refreshes runtime snapshots after invitation responses", async () => {
        vi.mocked(chatApi.respondInvitation).mockResolvedValue({
            invitation_id: 55,
            status: "accepted",
            member_id: 401,
        });
        vi.mocked(chatGetRoomSnapshot).mockResolvedValue(roomSnapshot());
        useChatStore.getState().setCurrentRoomId(21);

        await chatRoomService.respondToInvitation(55, "accept", { roomId: 21, roomType: "direct" });

        expect(chatApi.respondInvitation).toHaveBeenCalledWith(55, "accept");
        expect(chatService.refreshRooms).toHaveBeenCalledWith(true);
        expect(chatGetRoomSnapshot).toHaveBeenCalledWith({ room_id: 21, force_refresh: true });
    });

    it("keeps createRoom as the backend mutation entrypoint and refreshes runtime rooms afterward", async () => {
        vi.mocked(chatApi.createRoom).mockResolvedValue({
            id: 21,
            type: "direct",
            name: "Mina Park",
            max_members: 2,
            allow_agent: false,
            created_at: "2026-04-12T04:20:00Z",
            already_existed: false,
        });

        const room = await chatRoomService.createRoom({
            type: "direct",
            name: "Mina Park",
            member_ids: [2],
        });

        expect(room.id).toBe(21);
        expect(chatApi.createRoom).toHaveBeenCalledWith({
            type: "direct",
            name: "Mina Park",
            member_ids: [2],
        });
        expect(chatService.refreshRooms).toHaveBeenCalledWith(true);
    });

    it("marks the room as read before notifying the runtime when the active room changes", async () => {
        useChatStore.setState({
            rooms: {
                direct: [{
                    room_id: 21,
                    room_type: "direct",
                    display_name: "Mina Park",
                    unread_count: 3,
                }],
                group: [],
                channel: [],
                bot: [],
            },
        });

        await chatRoomService.setActiveRoom(21);

        expect(useChatStore.getState().currentRoomId).toBe(21);
        expect(useChatStore.getState().rooms.direct[0]?.unread_count).toBe(0);
        expect(chatMarkRoomRead).toHaveBeenCalledWith(21);
        expect(chatSetActiveRoom).toHaveBeenCalledWith(21);
        expect(vi.mocked(chatSetActiveRoom).mock.invocationCallOrder[0])
            .toBeGreaterThan(vi.mocked(chatMarkRoomRead).mock.invocationCallOrder[0]);
    });

    it("still notifies the runtime when the activation mark-as-read request fails", async () => {
        vi.mocked(chatMarkRoomRead).mockRejectedValueOnce(new Error("mark read failed"));

        await expect(chatRoomService.setActiveRoom(21)).resolves.toBeUndefined();

        expect(chatMarkRoomRead).toHaveBeenCalledWith(21);
        expect(chatSetActiveRoom).toHaveBeenCalledWith(21);
    });
});
