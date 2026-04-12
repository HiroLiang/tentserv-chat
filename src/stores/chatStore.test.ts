import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chatStore.ts";
import {
    LATEST_MESSAGE_FALLBACK,
    WAITING_FOR_PEER_KEY_LABEL,
    WAITING_FOR_SENDER_KEY_SENTINEL,
} from "@/utils/chatCopy.ts";

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

        useChatStore.getState().appendMessage(11, {
            message_id: 91,
            sender_id: 201,
            type: "text",
            content: "fresh message",
            is_edited: false,
            created_at: "2026-04-12T04:00:00Z",
        });

        const state = useChatStore.getState();
        expect(state.rooms.direct.map((room) => room.room_id)).toEqual([11, 10]);
        expect(state.rooms.direct[0]).toMatchObject({
            latest_message: "fresh message",
            latest_message_sender_id: 201,
            latest_message_created_at: "2026-04-12T04:00:00Z",
            unread_count: 3,
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

        useChatStore.getState().appendMessage(12, {
            message_id: 92,
            sender_id: 202,
            type: "text",
            content: WAITING_FOR_SENDER_KEY_SENTINEL,
            is_edited: false,
            created_at: "2026-04-12T05:00:00Z",
        });

        const state = useChatStore.getState();
        expect(state.messages[12][0]?.content).toBe(WAITING_FOR_SENDER_KEY_SENTINEL);
        expect(state.rooms.direct[0]).toMatchObject({
            latest_message: WAITING_FOR_PEER_KEY_LABEL,
            latest_message_sender_id: 202,
            latest_message_created_at: "2026-04-12T05:00:00Z",
            unread_count: 2,
        });
    });

    it("keeps non-direct waiting sender-key previews on the generic fallback", () => {
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

        useChatStore.getState().appendMessage(13, {
            message_id: 93,
            sender_id: 203,
            type: "text",
            content: WAITING_FOR_SENDER_KEY_SENTINEL,
            is_edited: false,
            created_at: "2026-04-12T06:00:00Z",
        });

        const state = useChatStore.getState();
        expect(state.messages[13][0]?.content).toBe(WAITING_FOR_SENDER_KEY_SENTINEL);
        expect(state.rooms.group[0]).toMatchObject({
            latest_message: LATEST_MESSAGE_FALLBACK,
            latest_message_sender_id: 203,
            latest_message_created_at: "2026-04-12T06:00:00Z",
            unread_count: 1,
        });
    });
});
