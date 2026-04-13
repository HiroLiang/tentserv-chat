import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatRoomService } from "@/services/chatRoomService.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import {
    CHAT_RUNTIME_DEGRADED_MESSAGE,
    CHAT_RUNTIME_UNAVAILABLE_MESSAGE,
} from "@/utils/chatCopy.ts";
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
        chat: {
            name: string;
            blockedByPeer?: boolean;
            blockedByMe?: boolean;
            isOnline?: boolean;
            lastSeenAt?: string;
            peerUserId?: number;
        };
        messages: Array<{ senderAvatarUrl?: string }>;
    }) => (
        <div
            data-testid="chat-room"
            data-blocked-by-peer={chat.blockedByPeer ? "true" : "false"}
            data-blocked-by-me={chat.blockedByMe ? "true" : "false"}
            data-is-online={chat.isOnline ? "true" : "false"}
            data-last-seen-at={chat.lastSeenAt ?? ""}
            data-peer-user-id={chat.peerUserId ?? ""}
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
        setActiveRoom: vi.fn(),
        retryMessage: vi.fn(),
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
            direct_key_status: "unlocked",
            member_count: 2,
        });
        vi.mocked(chatRoomService.loadMessages).mockResolvedValue(undefined);
        vi.mocked(chatRoomService.setActiveRoom).mockResolvedValue(undefined);
        vi.mocked(chatRoomService.retryMessage).mockResolvedValue(undefined);
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
                    peer_user_id: 2,
                    presence_status: "offline",
                    last_seen_at: "2026-04-12T02:03:04Z",
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
                    client_message_id: "local-9001",
                    message_id: 9001,
                    sender_id: 1002,
                    type: "text",
                    content: "hello",
                    is_edited: false,
                    is_deleted: false,
                    created_at: "2026-01-01T00:00:00Z",
                    sort_key: Date.parse("2026-01-01T00:00:00Z"),
                    delivery_status: "sent",
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
        expect(chatRoom).toHaveAttribute("data-is-online", "false");
        expect(chatRoom).toHaveAttribute("data-last-seen-at", "2026-04-12T02:03:04Z");
        expect(chatRoom).toHaveAttribute("data-peer-user-id", "2");
        expect(screen.getByTestId("message-avatar-url")).toHaveTextContent("avatars/bell.png");
    });

    it("shows a chat unavailable message when the runtime failed to start", async () => {
        useChatStore.setState({
            runtimeStatus: "failed",
            runtimeError: "Chat runtime is unavailable.",
        });

        render(
            <MemoryRouter initialEntries={["/chat"]}>
                <ChatPage />
            </MemoryRouter>,
        );

        expect(await screen.findByText(CHAT_RUNTIME_UNAVAILABLE_MESSAGE)).toBeInTheDocument();
        expect(screen.queryByText("Chat runtime is unavailable.")).not.toBeInTheDocument();
    });

    it("shows a friendly degraded realtime banner", async () => {
        useChatStore.setState({
            runtimeStatus: "degraded",
            runtimeError: "raw internal details",
        });

        render(
            <MemoryRouter initialEntries={["/chat"]}>
                <ChatPage />
            </MemoryRouter>,
        );

        expect(await screen.findByText(CHAT_RUNTIME_DEGRADED_MESSAGE)).toBeInTheDocument();
        expect(screen.queryByText("raw internal details")).not.toBeInTheDocument();
    });
});
