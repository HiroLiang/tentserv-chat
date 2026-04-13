import type React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatRoom } from "./ChatRoom.tsx";
import { chatRoomService } from "@/services/chatRoomService.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import type { ChatGroup, ChatMessage } from "@/types/ui.ts";
import {
    DIRECT_ROOM_WAITING_HINT,
    DIRECT_ROOM_WAITING_TITLE,
    WAITING_FOR_PEER_KEY_LABEL,
    WAITING_FOR_SENDER_KEY_SENTINEL,
} from "@/utils/chatCopy.ts";

const envMock = vi.hoisted(() => ({
    API_BASE_URL: "http://api.test",
}));

vi.mock("@/config/env.ts", () => ({
    env: envMock,
}));

vi.mock("@/services/chatRoomService.ts", () => ({
    chatRoomService: {
        respondToInvitation: vi.fn(),
    },
}));

vi.mock("@/components/ui/avatar.tsx", async () => {
    const React = await import("react");
    return {
        Avatar: React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
            ({ children, ...props }, ref) => React.createElement("span", { ...props, ref }, children),
        ),
        AvatarImage: React.forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(
            (props, ref) => React.createElement("img", { ...props, ref }),
        ),
        AvatarFallback: React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
            ({ children, ...props }, ref) => React.createElement("span", { ...props, ref }, children),
        ),
    };
});

const botChat: ChatGroup = {
    id: "7",
    type: "bot",
    name: "Helper Bot",
};

const directChat: ChatGroup = {
    id: "8",
    type: "direct",
    name: "Luna Stone",
    avatarUrl: "avatars/luna.png",
    isOnline: true,
    presenceStatus: "online",
};

const groupChat: ChatGroup = {
    id: "9",
    type: "group",
    name: "Crew",
    memberCount: 3,
};

const onRetryMessage = vi.fn();

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

const renderRoom = (props: Partial<React.ComponentProps<typeof ChatRoom>> = {}) =>
    render(
        <ChatRoom
            chat={botChat}
            messages={[]}
            onSendMessage={vi.fn()}
            onRetryMessage={onRetryMessage}
            {...props}
        />,
    );

describe("ChatRoom", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetChatStore();
    });

    it("does not send on Enter while IME composition is confirming text", () => {
        const onSendMessage = vi.fn();
        renderRoom({ onSendMessage });

        const input = screen.getByPlaceholderText("Message Helper Bot...");
        fireEvent.change(input, { target: { value: "你好" } });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 229 });

        expect(onSendMessage).not.toHaveBeenCalled();
        expect(input).toHaveValue("你好");
    });

    it("sends on Enter when not composing", () => {
        const onSendMessage = vi.fn();
        renderRoom({ onSendMessage });

        const input = screen.getByPlaceholderText("Message Helper Bot...");
        fireEvent.change(input, { target: { value: "Hello" } });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });

        expect(onSendMessage).toHaveBeenCalledWith("Hello");
        expect(input).toHaveValue("");
    });

    it("uses the direct room avatar URL when one is available", () => {
        renderRoom({ chat: directChat });

        const avatar = screen.getByAltText("Luna Stone avatar");
        expect(avatar).toHaveAttribute("src", "http://api.test/static/avatars/luna.png");
    });

    it("renders a deleted direct room as unavailable", () => {
        renderRoom({
            chat: { ...directChat, status: "deleted", name: "Deleted Contact" },
        });

        const input = screen.getByPlaceholderText("This chat is no longer available.");
        expect(input).toBeDisabled();
        expect(screen.queryByAltText("Deleted Contact avatar")).not.toBeInTheDocument();
        expect(screen.getByText("Deleted")).toBeInTheDocument();
    });

    it("renders a blocked-by-peer direct room as readonly", () => {
        renderRoom({
            chat: { ...directChat, blockedByPeer: true },
        });

        expect(screen.getByPlaceholderText("You have been blocked by this user.")).toBeDisabled();
        expect(screen.getAllByText("You have been blocked by this user.").length).toBeGreaterThan(0);
    });

    it("uses the sender avatar URL for incoming message avatars", () => {
        const messages: ChatMessage[] = [{
            id: "1",
            chatId: "9",
            senderId: "101",
            senderName: "Mina Park",
            senderAvatarUrl: "avatars/mina.png",
            content: "Hello",
            timestamp: "10:00",
            isMe: false,
            deliveryStatus: "sent",
        }];

        renderRoom({ chat: groupChat, messages });

        const avatar = screen.getByAltText("Mina Park avatar");
        expect(avatar).toHaveAttribute("src", "http://api.test/static/avatars/mina.png");
    });

    it("renders missing peer key copy for waiting sender-key messages", () => {
        useChatStore.getState().setDirectKeyStatus(Number(directChat.id), "unlocked");
        const messages: ChatMessage[] = [{
            id: "2",
            chatId: directChat.id,
            senderId: "101",
            senderName: "Luna Stone",
            content: WAITING_FOR_SENDER_KEY_SENTINEL,
            timestamp: "10:00",
            isMe: false,
            deliveryStatus: "sent",
        }];

        renderRoom({ chat: directChat, messages });

        expect(screen.getByText(WAITING_FOR_PEER_KEY_LABEL)).toBeInTheDocument();
    });

    it("shows pending delivery state for local echo messages", () => {
        useChatStore.getState().setDirectKeyStatus(Number(directChat.id), "unlocked");
        const messages: ChatMessage[] = [{
            id: "3",
            chatId: directChat.id,
            senderId: "201",
            senderName: "Me",
            content: "Sending message",
            timestamp: "10:01",
            isMe: true,
            clientMessageId: "local-3",
            deliveryStatus: "pending",
        }];

        renderRoom({ chat: directChat, messages });

        expect(screen.getByText("Sending...")).toBeInTheDocument();
    });

    it("shows retry affordance for failed outgoing messages", () => {
        useChatStore.getState().setDirectKeyStatus(Number(directChat.id), "unlocked");
        const messages: ChatMessage[] = [{
            id: "4",
            chatId: directChat.id,
            senderId: "201",
            senderName: "Me",
            content: "Failed message",
            timestamp: "10:02",
            isMe: true,
            clientMessageId: "local-4",
            deliveryStatus: "failed",
            deliveryError: "network error",
        }];

        renderRoom({ chat: directChat, messages });

        fireEvent.click(screen.getByRole("button", { name: /retry/i }));
        expect(onRetryMessage).toHaveBeenCalledWith("local-4");
        expect(screen.getByText("network error")).toBeInTheDocument();
    });

    it("renders clearer locked copy and relative last-seen status for direct chats", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-04-12T08:00:00Z"));
        useChatStore.getState().setDirectKeyStatus(Number(directChat.id), "locked");

        renderRoom({
            chat: {
                ...directChat,
                isOnline: false,
                presenceStatus: "offline",
                lastSeenAt: "2026-04-12T07:55:00Z",
            },
        });

        expect(screen.getByText("Last seen 5 minutes ago")).toBeInTheDocument();
        expect(screen.getAllByText(DIRECT_ROOM_WAITING_TITLE).length).toBeGreaterThan(0);
        expect(screen.getAllByText(DIRECT_ROOM_WAITING_HINT).length).toBeGreaterThan(0);
        expect(screen.getByPlaceholderText(DIRECT_ROOM_WAITING_TITLE)).toBeDisabled();

        vi.useRealTimers();
    });

    it("submits invitation responses through the chat room service", () => {
        useChatStore.setState({
            pendingInvitation: {
                found: true,
                invitation_id: 55,
                role: "invitee",
                inviter_name: "Luna Stone",
                inviter_user_id: 22,
            },
        });
        useChatStore.getState().setDirectKeyStatus(Number(directChat.id), "unlocked");

        renderRoom({ chat: directChat });

        fireEvent.click(screen.getByRole("button", { name: /accept/i }));
        expect(chatRoomService.respondToInvitation).toHaveBeenCalledWith(55, "accept", {
            roomId: 8,
            roomType: "direct",
            inviterUserId: 22,
        });
    });
});
