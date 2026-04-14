import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chatStore.ts";
import {
    WAITING_FOR_PEER_KEY_LABEL,
    WAITING_FOR_SENDER_KEY_SENTINEL,
} from "@/utils/chatCopy.ts";
import type { Message } from "@/types/chat.ts";

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

const message = (overrides: Partial<Message>): Message => ({
    client_message_id: overrides.client_message_id ?? `client-${overrides.message_id ?? overrides.sort_key ?? 1}`,
    message_id: overrides.message_id ?? null,
    sender_id: overrides.sender_id ?? 1,
    sender_device_id: overrides.sender_device_id ?? "device-1",
    sender_key_version: overrides.sender_key_version ?? 0,
    type: overrides.type ?? "text",
    content: overrides.content ?? "",
    reply_to_id: overrides.reply_to_id,
    is_edited: overrides.is_edited ?? false,
    is_deleted: overrides.is_deleted ?? false,
    created_at: overrides.created_at ?? "2026-04-12T00:00:00Z",
    sort_key: overrides.sort_key ?? Date.parse(overrides.created_at ?? "2026-04-12T00:00:00Z"),
    delivery_status: overrides.delivery_status ?? "sent",
    delivery_error: overrides.delivery_error,
    is_local_echo: overrides.is_local_echo,
});

describe("chatStore room activity ordering", () => {
    beforeEach(() => {
        resetChatStore();
    });

    it("sorts each room section by latest message time without mixing sections", () => {
        useChatStore.getState().setRooms({
            direct: [
                {
                    room_id: 1,
                    room_type: "direct",
                    display_name: "Older Direct",
                    latest_message: "older",
                    latest_message_created_at: "2026-04-12T01:00:00Z",
                    unread_count: 0,
                },
                {
                    room_id: 2,
                    room_type: "direct",
                    display_name: "Newer Direct",
                    latest_message: "newer",
                    latest_message_created_at: "2026-04-12T02:00:00Z",
                    unread_count: 0,
                },
            ],
            group: [
                {
                    room_id: 3,
                    room_type: "group",
                    display_name: "Older Group",
                    latest_message: "older group",
                    latest_message_created_at: "2026-04-12T00:30:00Z",
                    unread_count: 0,
                },
                {
                    room_id: 4,
                    room_type: "group",
                    display_name: "Newer Group",
                    latest_message: "newer group",
                    latest_message_created_at: "2026-04-12T03:00:00Z",
                    unread_count: 0,
                },
            ],
            channel: [],
            bot: [],
        });

        const state = useChatStore.getState();
        expect(state.rooms.direct.map((room) => room.room_id)).toEqual([2, 1]);
        expect(state.rooms.group.map((room) => room.room_id)).toEqual([4, 3]);
    });

    it("moves a room to the top of its section and updates unread count when a new message arrives", () => {
        useChatStore.getState().setRooms({
            direct: [
                {
                    room_id: 10,
                    room_type: "direct",
                    display_name: "Selected",
                    latest_message: "current",
                    latest_message_created_at: "2026-04-12T01:00:00Z",
                    unread_count: 0,
                },
                {
                    room_id: 11,
                    room_type: "direct",
                    display_name: "Background",
                    latest_message: "background",
                    latest_message_created_at: "2026-04-12T00:30:00Z",
                    unread_count: 2,
                },
            ],
            group: [],
            channel: [],
            bot: [],
        });
        useChatStore.getState().setCurrentRoomId(10);

        useChatStore.getState().appendMessage(11, message({
            message_id: 91,
            sender_id: 201,
            type: "text",
            content: "fresh message",
            is_edited: false,
            created_at: "2026-04-12T04:00:00Z",
        }));

        const state = useChatStore.getState();
        expect(state.rooms.direct.map((room) => room.room_id)).toEqual([11, 10]);
        expect(state.rooms.direct[0]).toMatchObject({
            latest_message: "fresh message",
            latest_message_sender_id: 201,
            latest_message_created_at: "2026-04-12T04:00:00Z",
            unread_count: 2,
        });
    });

    it("normalizes waiting sender-key previews for direct rooms while keeping the stored message sentinel", () => {
        useChatStore.getState().setRooms({
            direct: [
                {
                    room_id: 12,
                    room_type: "direct",
                    display_name: "Bell",
                    latest_message: "older",
                    latest_message_created_at: "2026-04-12T01:00:00Z",
                    unread_count: 1,
                },
            ],
            group: [],
            channel: [],
            bot: [],
        });

        useChatStore.getState().appendMessage(12, message({
            message_id: 92,
            sender_id: 202,
            type: "text",
            content: WAITING_FOR_SENDER_KEY_SENTINEL,
            is_edited: false,
            created_at: "2026-04-12T05:00:00Z",
        }));

        const state = useChatStore.getState();
        expect(state.messages[12][0]?.content).toBe(WAITING_FOR_SENDER_KEY_SENTINEL);
        expect(state.rooms.direct[0]).toMatchObject({
            latest_message: WAITING_FOR_PEER_KEY_LABEL,
            latest_message_sender_id: 202,
            latest_message_created_at: "2026-04-12T05:00:00Z",
            unread_count: 1,
        });
    });

    it("humanizes waiting sender-key previews for every room type", () => {
        useChatStore.getState().setRooms({
            direct: [],
            group: [
                {
                    room_id: 13,
                    room_type: "group",
                    display_name: "Crew",
                    latest_message: "older",
                    latest_message_created_at: "2026-04-12T01:00:00Z",
                    unread_count: 0,
                },
            ],
            channel: [],
            bot: [],
        });

        useChatStore.getState().appendMessage(13, message({
            message_id: 93,
            sender_id: 203,
            type: "text",
            content: WAITING_FOR_SENDER_KEY_SENTINEL,
            is_edited: false,
            created_at: "2026-04-12T06:00:00Z",
        }));

        const state = useChatStore.getState();
        expect(state.messages[13][0]?.content).toBe(WAITING_FOR_SENDER_KEY_SENTINEL);
        expect(state.rooms.group[0]).toMatchObject({
            latest_message: WAITING_FOR_PEER_KEY_LABEL,
            latest_message_sender_id: 203,
            latest_message_created_at: "2026-04-12T06:00:00Z",
            unread_count: 0,
        });
    });

    it("normalizes waiting previews coming directly from snapshot updates", () => {
        useChatStore.getState().setRooms({
            direct: [{
                room_id: 14,
                room_type: "direct",
                display_name: "Mizi Liang",
                latest_message: WAITING_FOR_SENDER_KEY_SENTINEL,
                latest_message_created_at: "2026-04-12T06:30:00Z",
                unread_count: 0,
            }],
            group: [],
            channel: [],
            bot: [],
        });

        expect(useChatStore.getState().rooms.direct[0]?.latest_message).toBe(WAITING_FOR_PEER_KEY_LABEL);
    });

    it("preserves a previously decrypted preview when a later snapshot regresses to waiting for the same message", () => {
        const store = useChatStore.getState();
        store.setRooms({
            direct: [{
                room_id: 16,
                room_type: "direct",
                display_name: "Bell",
                latest_message: "Decrypted hello",
                latest_message_id: 501,
                latest_message_created_at: "2026-04-12T06:45:00Z",
                latest_message_sender_id: 9001,
                latest_message_sender_device_id: "device-bell-1",
                latest_message_sender_key_version: 1776091234000,
                unread_count: 0,
            }],
            group: [],
            channel: [],
            bot: [],
        });

        store.setRooms({
            direct: [{
                room_id: 16,
                room_type: "direct",
                display_name: "Bell",
                latest_message: WAITING_FOR_SENDER_KEY_SENTINEL,
                latest_message_id: 501,
                latest_message_created_at: "2026-04-12T06:45:00Z",
                latest_message_sender_id: 9001,
                latest_message_sender_device_id: "device-bell-1",
                latest_message_sender_key_version: 1776091234000,
                unread_count: 0,
            }],
            group: [],
            channel: [],
            bot: [],
        });

        expect(useChatStore.getState().rooms.direct[0]).toMatchObject({
            latest_message: "Decrypted hello",
            latest_message_id: 501,
            latest_message_sender_device_id: "device-bell-1",
            latest_message_sender_key_version: 1776091234000,
        });
    });

    it("keeps the previous direct room identity when a later snapshot is missing display fields", () => {
        const store = useChatStore.getState();
        store.setRooms({
            direct: [{
                room_id: 15,
                room_type: "direct",
                display_name: "Mizi Liang",
                avatar_url: "avatars/mizi.png",
                latest_message: "hello",
                latest_message_created_at: "2026-04-12T01:00:00Z",
                unread_count: 0,
            }],
            group: [],
            channel: [],
            bot: [],
        });

        store.setRooms({
            direct: [{
                room_id: 15,
                room_type: "direct",
                display_name: "",
                latest_message: "",
                latest_message_created_at: "2026-04-12T02:00:00Z",
                unread_count: 1,
            }],
            group: [],
            channel: [],
            bot: [],
        });

        expect(useChatStore.getState().rooms.direct[0]).toMatchObject({
            display_name: "Mizi Liang",
            avatar_url: "avatars/mizi.png",
            latest_message: "hello",
            unread_count: 1,
        });
    });

    it("does not increment unread when appending a message to the active room", () => {
        useChatStore.getState().setRooms({
            direct: [{
                room_id: 21,
                room_type: "direct",
                display_name: "Current",
                latest_message: "older",
                latest_message_created_at: "2026-04-12T01:00:00Z",
                unread_count: 4,
            }],
            group: [],
            channel: [],
            bot: [],
        });
        useChatStore.getState().setCurrentRoomId(21);

        useChatStore.getState().appendMessage(21, message({
            message_id: 94,
            sender_id: 301,
            content: "read in room",
            created_at: "2026-04-12T07:00:00Z",
        }));

        expect(useChatStore.getState().rooms.direct[0]?.unread_count).toBe(4);
    });

    it("preserves the structured self sender key sync snapshot when later sync-state updates only include status fields", () => {
        const store = useChatStore.getState();
        store.setSyncState({
            ws_status: "idle",
            pending_business_jobs: 0,
            pending_sync_jobs: 0,
            self_sender_key_sync_status: "pending_provider",
            self_sender_key_sync_error: null,
            self_sender_key_sync: {
                exists: true,
                status: "pending_provider",
                requester_current_device: true,
                provider_current_device: false,
                requester_device: {
                    device_id: "device-new",
                    device_name: "Hiro's New Mac",
                    platform: "macos",
                },
            },
        });

        store.setSyncState({
            ws_status: "connected",
            pending_business_jobs: 0,
            pending_sync_jobs: 0,
            self_sender_key_sync_status: "syncing",
            self_sender_key_sync_error: null,
            self_sender_key_sync: null,
        });

        expect(useChatStore.getState().syncState?.self_sender_key_sync).toMatchObject({
            exists: true,
            status: "syncing",
            requester_current_device: true,
            requester_device: {
                device_id: "device-new",
            },
        });
    });

    it("deduplicates a pending local row with the later server-backed row using the server message id", () => {
        const store = useChatStore.getState();
        store.setMessages(30, [
            message({
                client_message_id: "local:30:1",
                message_id: 120,
                sender_id: 401,
                content: "hello",
                created_at: "2026-04-12T08:00:00Z",
                delivery_status: "sent",
                is_local_echo: false,
            }),
            message({
                client_message_id: "server:120",
                message_id: 120,
                sender_id: 401,
                content: "hello",
                created_at: "2026-04-12T08:00:00Z",
                delivery_status: "sent",
                is_local_echo: false,
            }),
        ], false);

        const messages = useChatStore.getState().messages[30] ?? [];
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
            message_id: 120,
            content: "hello",
        });
    });
});
