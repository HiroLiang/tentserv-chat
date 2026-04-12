import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chatStore.ts";

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
});
