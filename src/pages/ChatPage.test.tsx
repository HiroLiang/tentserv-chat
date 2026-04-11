import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatRoomService } from "@/services/chatRoomService.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { ChatPage } from "./ChatPage.tsx";

vi.mock("@/components/layout/Navbar.tsx", () => ({
    Navbar: () => <div data-testid="navbar" />,
}));

vi.mock("@/components/chat/ChatSidebar.tsx", () => ({
    ChatSidebar: () => <div data-testid="chat-sidebar" />,
}));

vi.mock("@/components/chat/ChatRoom.tsx", () => ({
    ChatRoom: ({
        chat,
        messages,
    }: {
        chat: { name: string; blockedByPeer?: boolean; blockedByMe?: boolean };
        messages: Array<{ senderAvatarUrl?: string }>;
    }) => (
        <div
            data-testid="chat-room"
            data-blocked-by-peer={chat.blockedByPeer ? "true" : "false"}
            data-blocked-by-me={chat.blockedByMe ? "true" : "false"}
        >
            <span>{chat.name}</span>
            {messages.map((message, index) => (
                <span key={index} data-testid="message-avatar-url">{message.senderAvatarUrl ?? ""}</span>
            ))}
        </div>
    ),
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

const resetUserStore = () => {
    useUserStore.setState({
        currentUser: { id: 1 },
        recordedUsers: new Map(),
        participantId: null,
    });
};

describe("ChatPage room selection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetChatStore();
        resetUserStore();
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
        expect(chatRoomService.loadRoomDetail).toHaveBeenCalledWith(42, { persist: true, hydrateMessages: true });
        expect(chatRoomService.loadMessages).not.toHaveBeenCalled();
        expect(chatRoomService.markAsRead).toHaveBeenCalledTimes(1);
    });

    it("maps blocked direct room status and member avatars into ChatRoom props", async () => {
        useUserStore.setState({ participantId: 501 });
        useChatStore.setState({
            rooms: {
                direct: [{
                    room_id: 42,
                    room_type: "direct",
                    display_name: "Bell",
                    unread_count: 0,
                    blocked_by_me: true,
                    blocked_by_peer: true,
                }],
                group: [],
                channel: [],
                bot: [],
            },
            currentRoomDetail: {
                room_id: 42,
                room_type: "direct",
                name: "Bell",
                members: [
                    {
                        member_id: 1001,
                        participant_id: 501,
                        user_id: 1,
                        display_name: "Me",
                        avatar_url: "avatars/me.png",
                        role: "member",
                        joined_at: "2026-01-01T00:00:00Z",
                    },
                    {
                        member_id: 1002,
                        participant_id: 502,
                        user_id: 2,
                        display_name: "Bell",
                        avatar_url: "avatars/bell.png",
                        role: "member",
                        joined_at: "2026-01-01T00:00:00Z",
                    },
                ],
                messages: [],
            },
            messages: {
                42: [{
                    message_id: 9001,
                    sender_id: 1002,
                    type: "text",
                    content: "hello",
                    is_edited: false,
                    created_at: "2026-01-01T00:00:00Z",
                }],
            },
        });

        render(
            <MemoryRouter initialEntries={["/chat?room_id=42"]}>
                <ChatPage />
            </MemoryRouter>,
        );

        const chatRoom = await screen.findByTestId("chat-room");
        expect(chatRoom).toHaveAttribute("data-blocked-by-peer", "true");
        expect(chatRoom).toHaveAttribute("data-blocked-by-me", "true");
        expect(screen.getByTestId("message-avatar-url")).toHaveTextContent("avatars/bell.png");
    });
});
