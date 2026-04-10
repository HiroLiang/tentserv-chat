import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatRoomService } from "@/services/chatRoomService.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import { ChatPage } from "./ChatPage.tsx";

vi.mock("@/components/layout/Navbar.tsx", () => ({
    Navbar: () => <div data-testid="navbar" />,
}));

vi.mock("@/components/chat/ChatSidebar.tsx", () => ({
    ChatSidebar: () => <div data-testid="chat-sidebar" />,
}));

vi.mock("@/components/chat/ChatRoom.tsx", () => ({
    ChatRoom: ({ chat }: { chat: { name: string } }) => <div data-testid="chat-room">{chat.name}</div>,
}));

vi.mock("@/services/chatRoomService.ts", () => ({
    chatRoomService: {
        loadRooms: vi.fn(),
        loadRoomDetail: vi.fn(),
        loadMessages: vi.fn(),
        markAsRead: vi.fn(),
        sendMessage: vi.fn(),
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
};

describe("ChatPage room selection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetChatStore();
        vi.mocked(chatRoomService.loadRooms).mockResolvedValue(undefined);
        vi.mocked(chatRoomService.loadRoomDetail).mockResolvedValue({
            room_id: 42,
            room_type: "direct",
            name: "Bell",
            members: [],
            messages: [],
        });
        vi.mocked(chatRoomService.loadMessages).mockResolvedValue(undefined);
        vi.mocked(chatRoomService.markAsRead).mockImplementation(async (roomId: number) => {
            useChatStore.getState().clearUnreadCount(roomId);
        });
    });

    it("does not reload the selected room when mark-as-read only changes unread count", async () => {
        useChatStore.setState({
            rooms: {
                direct: [{
                    room_id: 42,
                    room_type: "direct",
                    display_name: "Bell",
                    unread_count: 3,
                }],
                group: [],
                channel: [],
                bot: [],
            },
        });

        render(
            <MemoryRouter initialEntries={["/chat?room_id=42"]}>
                <ChatPage />
            </MemoryRouter>,
        );

        await waitFor(() => expect(useChatStore.getState().rooms.direct[0].unread_count).toBe(0));
        await new Promise(resolve => window.setTimeout(resolve, 20));

        expect(chatRoomService.loadRoomDetail).toHaveBeenCalledTimes(1);
        expect(chatRoomService.loadMessages).toHaveBeenCalledTimes(1);
        expect(chatRoomService.markAsRead).toHaveBeenCalledTimes(1);
    });
});
