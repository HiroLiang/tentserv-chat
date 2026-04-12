import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { chatService } from "./chatService.ts";
import { wsService } from "./wsService.ts";
import { chatParticipantService } from "./chatParticipantService.ts";
import { chatRoomService } from "./chatRoomService.ts";
import { e2eeService } from "./e2eeService.ts";
import { e2eeApi } from "@/api/index.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import { useE2eeStore } from "@/stores/e2eeStore.ts";
import {
    WAITING_FOR_PEER_KEY_LABEL,
    WAITING_FOR_SENDER_KEY_SENTINEL,
} from "@/utils/chatCopy.ts";

vi.mock("./wsService.ts", () => ({
    wsService: {
        on: vi.fn(),
        off: vi.fn(),
        send: vi.fn(),
    },
}));

vi.mock("./chatParticipantService.ts", () => ({
    chatParticipantService: {
        ensureParticipant: vi.fn(),
    },
}));

vi.mock("./chatRoomService.ts", () => ({
    chatRoomService: {
        loadRooms: vi.fn(),
        loadRoomDetail: vi.fn(),
        initializeDirectRoomEncryption: vi.fn(),
        initializeGroupRoomEncryption: vi.fn(),
    },
}));

vi.mock("./e2eeService.ts", () => ({
    e2eeService: {
        decryptMessage: vi.fn(),
        resolveDirectKey: vi.fn(),
    },
}));

vi.mock("@/api/index.ts", () => ({
    e2eeApi: {
        getSenderKeyDistributionStatus: vi.fn(),
    },
}));

vi.mock("@/utils/logger.ts", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
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
    });
    useE2eeStore.setState({
        bootstrapStatus: "ready",
        keysUploaded: true,
        otpKeyCount: 0,
        otpKeyTargetCount: 0,
        otpReplenishThreshold: 0,
        bootstrapError: null,
        senderKeyRequests: new Set(),
    });
};

describe("chatService sender-key handling", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetChatStore();
        (chatService as unknown as { handlersRegistered: boolean }).handlersRegistered = false;

        vi.mocked(chatParticipantService.ensureParticipant).mockResolvedValue(undefined);
        vi.mocked(chatRoomService.loadRooms).mockResolvedValue(undefined);
        vi.mocked(e2eeApi.getSenderKeyDistributionStatus).mockResolvedValue({
            own_sender_key_exists: true,
            requestable_member_ids: [],
            available_from_member_ids: [],
            available_to_member_ids: [],
            pending_receivers: [],
            pending_from_members: [],
        });
        vi.mocked(e2eeService.decryptMessage).mockImplementation(async (content: string) => content);
        vi.mocked(e2eeService.resolveDirectKey).mockResolvedValue(true);
    });

    it("registers requester-side direct_key_ready handling without a duplicate provider-side sender_key_needed listener", async () => {
        await chatService.initialize();

        expect(wsService.on).toHaveBeenCalledWith("e2ee.direct_key_ready", expect.any(Function));
        expect(wsService.on).toHaveBeenCalledWith("presence.user_status_changed", expect.any(Function));
        expect(vi.mocked(wsService.on).mock.calls.some(([event]) => event === "e2ee.sender_key_needed")).toBe(false);
    });

    it("updates direct room status to unlocked when direct_key_ready resolves successfully", async () => {
        await chatService.initialize();
        const handler = getWSHandler("e2ee.direct_key_ready");

        await handler({ room_id: 88, provider_member_id: 202 });

        await waitFor(() => expect(e2eeService.resolveDirectKey).toHaveBeenCalledWith(88));
        expect(useChatStore.getState().directKeyStatus[88]).toBe("unlocked");
    });

    it("updates direct room status to locked when direct_key_ready still cannot unlock the room", async () => {
        vi.mocked(e2eeService.resolveDirectKey).mockResolvedValue(false);

        await chatService.initialize();
        const handler = getWSHandler("e2ee.direct_key_ready");

        await handler({ room_id: 89, provider_member_id: 203 });

        await waitFor(() => expect(e2eeService.resolveDirectKey).toHaveBeenCalledWith(89));
        expect(useChatStore.getState().directKeyStatus[89]).toBe("locked");
    });

    it("ignores malformed or failed direct_key_ready events safely", async () => {
        await chatService.initialize();
        const handler = getWSHandler("e2ee.direct_key_ready");

        await handler({ provider_member_id: 204 });
        expect(e2eeService.resolveDirectKey).not.toHaveBeenCalled();

        vi.mocked(e2eeService.resolveDirectKey).mockRejectedValueOnce(new Error("resolve failed"));
        await handler({ room_id: 90, provider_member_id: 204 });

        await waitFor(() => expect(e2eeService.resolveDirectKey).toHaveBeenCalledWith(90));
        expect(useChatStore.getState().directKeyStatus[90]).toBeUndefined();
    });

    it("updates matching direct room presence in place when a presence event arrives", async () => {
        useChatStore.setState({
            rooms: {
                direct: [{
                    room_id: 44,
                    room_type: "direct",
                    display_name: "Bell",
                    peer_user_id: 2,
                    presence_status: "offline",
                    unread_count: 0,
                }],
                group: [],
                channel: [],
                bot: [],
            },
        });

        await chatService.initialize();
        vi.mocked(chatRoomService.loadRooms).mockClear();
        const handler = getWSHandler("presence.user_status_changed");

        await handler({ user_id: 2, status: "online" });

        expect(useChatStore.getState().rooms.direct[0]).toMatchObject({
            peer_user_id: 2,
            presence_status: "online",
            last_seen_at: undefined,
        });
        expect(chatRoomService.loadRooms).not.toHaveBeenCalled();
    });

    it("maps waiting sender-key messages to a user-facing direct-room preview on chat.message", async () => {
        useChatStore.setState({
            rooms: {
                direct: [{
                    room_id: 55,
                    room_type: "direct",
                    display_name: "Bell",
                    unread_count: 0,
                }],
                group: [],
                channel: [],
                bot: [],
            },
        });
        vi.mocked(e2eeService.decryptMessage).mockResolvedValueOnce(WAITING_FOR_SENDER_KEY_SENTINEL);

        await chatService.initialize();
        const handler = getWSHandler("chat.message");

        await handler({
            message_id: 101,
            room_id: 55,
            sender_id: 205,
            content: "e2ee:v1:encrypted",
            type: "text",
            is_edited: false,
            is_deleted: false,
            created_at: "2026-04-12T07:00:00Z",
        });

        await waitFor(() => expect(e2eeService.decryptMessage).toHaveBeenCalledWith("e2ee:v1:encrypted", 205, 55));
        expect(useChatStore.getState().messages[55][0]?.content).toBe(WAITING_FOR_SENDER_KEY_SENTINEL);
        expect(useChatStore.getState().rooms.direct[0]).toMatchObject({
            latest_message: WAITING_FOR_PEER_KEY_LABEL,
            latest_message_sender_id: 205,
            latest_message_created_at: "2026-04-12T07:00:00Z",
            unread_count: 1,
        });
    });
});

const getWSHandler = (type: string): ((data: unknown) => unknown) => {
    const call = vi.mocked(wsService.on).mock.calls.find(([event]) => event === type);
    if (!call) throw new Error(`missing ws handler for ${type}`);
    return call[1] as (data: unknown) => unknown;
};
