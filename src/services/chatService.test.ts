import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    chatGetRoomsSnapshot,
    chatRuntimeStart,
    onChatMessageDeliveryUpdated,
    onChatRoomUpdated,
    onChatRoomsUpdated,
    onChatSyncStateChanged,
    type ChatDeliveryUpdate,
    type ChatRoomSnapshot,
    type ChatRoomsSnapshot,
    type ChatSyncState,
} from "@/bridge/chat.ts";
import { env } from "@/config/env.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { useE2eeStore } from "@/stores/e2eeStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { CHAT_RUNTIME_DEGRADED_MESSAGE } from "@/utils/chatCopy.ts";
import { chatService } from "./chatService.ts";

vi.mock("@/config/env.ts", () => ({
    env: {
        API_BASE_URL: "http://api.test",
        WS_BASE_URL: "ws://ws.test",
        IS_DEV: false,
    },
}));

vi.mock("@/bridge/chat.ts", () => ({
    CHAT_ROOMS_UPDATED_EVENT: "chat:rooms_updated",
    CHAT_ROOM_UPDATED_EVENT: "chat:room_updated",
    CHAT_MESSAGE_DELIVERY_UPDATED_EVENT: "chat:message_delivery_updated",
    CHAT_SYNC_STATE_CHANGED_EVENT: "chat:sync_state_changed",
    chatRuntimeStart: vi.fn(),
    chatRuntimeStop: vi.fn(),
    chatGetRoomsSnapshot: vi.fn(),
    onChatRoomsUpdated: vi.fn(),
    onChatRoomUpdated: vi.fn(),
    onChatMessageDeliveryUpdated: vi.fn(),
    onChatSyncStateChanged: vi.fn(),
}));

vi.mock("@/utils/logger.ts", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

const resetStores = () => {
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
    useDeviceStore.setState({
        deviceId: "device-1",
        deviceName: "MacBook",
        platform: "macos",
        registered: true,
        createdAt: 1000,
        updatedAt: null,
    });
    useUserStore.setState({
        currentUser: {
            id: 501,
            accountId: 42,
            token: "token-restored",
            isLoggedIn: true,
        },
        recordedUsers: new Map(),
        participantId: null,
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

const syncState = (overrides: Partial<ChatSyncState> = {}): ChatSyncState => ({
    ws_status: "connected",
    pending_business_jobs: 0,
    pending_sync_jobs: 0,
    self_sender_key_sync_status: "idle",
    ...overrides,
});

const roomsSnapshot = (): ChatRoomsSnapshot => ({
    participant_id: 701,
    rooms: {
        direct: [{
            room_id: 55,
            room_type: "direct",
            display_name: "Bell",
            latest_message: "hello",
            latest_message_created_at: "2026-04-12T07:00:00Z",
            latest_message_sender_id: 205,
            unread_count: 1,
            direct_key_status: "unlocked",
        }],
        group: [],
        channel: [],
        bot: [],
    },
    sync_state: syncState(),
});

const roomSnapshot = (): ChatRoomSnapshot => ({
    room_id: 55,
    room_type: "direct",
    name: "Bell",
    members: [
        {
            member_id: 205,
            participant_id: 702,
            display_name: "Bell",
            role: "member",
            joined_at: "2026-04-12T07:00:00Z",
        },
    ],
    messages: [{
        client_message_id: "server-101",
        message_id: 101,
        sender_id: 205,
        type: "text",
        content: "hello",
        is_edited: false,
        is_deleted: false,
        created_at: "2026-04-12T07:00:00Z",
        sort_key: Date.parse("2026-04-12T07:00:00Z"),
        delivery_status: "sent",
        is_local_echo: false,
    }],
    has_more: false,
    pending_invitation: null,
    direct_key_status: "unlocked",
    member_count: 2,
});

let roomsUpdatedHandler: ((payload: ChatRoomsSnapshot) => void) | undefined;
let roomUpdatedHandler: ((payload: ChatRoomSnapshot) => void) | undefined;
let deliveryUpdatedHandler: ((payload: ChatDeliveryUpdate) => void) | undefined;
let syncChangedHandler: ((payload: ChatSyncState) => void) | undefined;

describe("chatService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStores();
        (chatService as unknown as {
            initPromise: Promise<void> | null;
            listenersRegistered: boolean;
            unlisteners: Array<() => void>;
        }).initPromise = null;
        (chatService as unknown as {
            initPromise: Promise<void> | null;
            listenersRegistered: boolean;
            unlisteners: Array<() => void>;
        }).listenersRegistered = false;
        (chatService as unknown as {
            initPromise: Promise<void> | null;
            listenersRegistered: boolean;
            unlisteners: Array<() => void>;
        }).unlisteners = [];

        roomsUpdatedHandler = undefined;
        roomUpdatedHandler = undefined;
        deliveryUpdatedHandler = undefined;
        syncChangedHandler = undefined;

        vi.mocked(chatRuntimeStart).mockResolvedValue(roomsSnapshot());
        vi.mocked(chatGetRoomsSnapshot).mockResolvedValue(roomsSnapshot());
        vi.mocked(onChatRoomsUpdated).mockImplementation(async (handler) => {
            roomsUpdatedHandler = handler;
            return () => {};
        });
        vi.mocked(onChatRoomUpdated).mockImplementation(async (handler) => {
            roomUpdatedHandler = handler;
            return () => {};
        });
        vi.mocked(onChatMessageDeliveryUpdated).mockImplementation(async (handler) => {
            deliveryUpdatedHandler = handler;
            return () => {};
        });
        vi.mocked(onChatSyncStateChanged).mockImplementation(async (handler) => {
            syncChangedHandler = handler;
            return () => {};
        });
    });

    it("starts the Rust chat runtime with the authenticated session and hydrates stores", async () => {
        await chatService.initialize();

        expect(chatRuntimeStart).toHaveBeenCalledWith({
            api_base_url: env.API_BASE_URL,
            ws_base_url: env.WS_BASE_URL,
            token: "token-restored",
            account_id: 42,
            user_id: 501,
            device_id: "device-1",
        });
        expect(useUserStore.getState().participantId).toBe(701);
        expect(useChatStore.getState().rooms.direct[0]).toMatchObject({
            room_id: 55,
            display_name: "Bell",
            direct_key_status: "unlocked",
        });
        expect(useChatStore.getState().syncState?.ws_status).toBe("connected");
        expect(useChatStore.getState().runtimeStatus).toBe("ready");
    });

    it("skips startup when bootstrap is not ready", async () => {
        useE2eeStore.setState({ bootstrapStatus: "loading" });

        await chatService.initialize();

        expect(chatRuntimeStart).not.toHaveBeenCalled();
    });

    it("hydrates fresh room snapshots from runtime events", async () => {
        await chatService.initialize();
        useChatStore.getState().setCurrentRoomId(55);

        roomUpdatedHandler?.(roomSnapshot());

        expect(useChatStore.getState().currentRoomDetail?.room_id).toBe(55);
        expect(useChatStore.getState().messages[55][0]?.message_id).toBe(101);
        expect(useChatStore.getState().directKeyStatus[55]).toBe("unlocked");
    });

    it("updates room lists and sync state from runtime emits", async () => {
        await chatService.initialize();

        roomsUpdatedHandler?.({
            ...roomsSnapshot(),
            sync_state: syncState({ pending_sync_jobs: 3 }),
        });
        expect(useChatStore.getState().syncState).toMatchObject({
            ws_status: "connected",
            pending_sync_jobs: 3,
        });

        syncChangedHandler?.(syncState({ ws_status: "reconnecting" }));

        expect(useChatStore.getState().rooms.direct[0]?.room_id).toBe(55);
        expect(useChatStore.getState().syncState).toMatchObject({
            ws_status: "reconnecting",
        });
    });

    it("updates optimistic delivery state for local echo rows", async () => {
        await chatService.initialize();
        useChatStore.getState().setMessages(55, [{
            client_message_id: "local-55",
            message_id: null,
            sender_id: 701,
            type: "text",
            content: "hello",
            is_edited: false,
            is_deleted: false,
            created_at: "2026-04-12T07:05:00Z",
            sort_key: Date.parse("2026-04-12T07:05:00Z"),
            delivery_status: "pending",
            is_local_echo: true,
        }], false);

        deliveryUpdatedHandler?.({
            room_id: 55,
            client_message_id: "local-55",
            delivery_status: "failed",
            delivery_error: "network error",
            server_message_id: null,
        });

        expect(useChatStore.getState().messages[55][0]).toMatchObject({
            client_message_id: "local-55",
            delivery_status: "failed",
            delivery_error: "network error",
        });
    });

    it("refreshes rooms through the bridge on demand", async () => {
        useChatStore.getState().setRuntimeStatus("ready");

        await chatService.refreshRooms(true);

        expect(chatGetRoomsSnapshot).toHaveBeenCalledWith(true);
        expect(useChatStore.getState().rooms.direct[0]?.room_id).toBe(55);
    });

    it("starts the runtime before wiring listeners so listener registration failure degrades but does not block startup", async () => {
        vi.mocked(onChatSyncStateChanged).mockRejectedValueOnce(new Error("listen failed"));

        await chatService.initialize();

        expect(chatRuntimeStart).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().runtimeStatus).toBe("degraded");
        expect(useChatStore.getState().runtimeError).toBe(CHAT_RUNTIME_DEGRADED_MESSAGE);
    });
});
