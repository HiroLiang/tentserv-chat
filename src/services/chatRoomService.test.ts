import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatApi } from "@/api/index.ts";
import { e2eeService, WAITING_FOR_SENDER_KEY } from "@/services/e2eeService.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import type { GetUserRoomsResponse, RoomSummary } from "@/types/chat.ts";
import { chatRoomService, LATEST_MESSAGE_FALLBACK } from "./chatRoomService.ts";

vi.mock("@/api/index.ts", () => ({
    chatApi: {
        getRooms: vi.fn(),
    },
}));

vi.mock("@/services/e2eeService.ts", () => ({
    WAITING_FOR_SENDER_KEY: "WAITING_FOR_SENDER_KEY",
    e2eeService: {
        decryptMessage: vi.fn(),
    },
}));

vi.mock("@/utils/logger.ts", () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
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

describe("chatRoomService.loadRooms latest message summaries", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetChatStore();
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
});
