import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatRoom } from "./ChatRoom.tsx";
import { chatRoomService } from "@/services/chatRoomService.ts";
import { e2eeService } from "@/services/e2eeService.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import type { ChatGroup, ChatMessage } from "@/types/ui.ts";

const envMock = vi.hoisted(() => ({
    API_BASE_URL: "http://api.test",
}));

vi.mock("@/config/env.ts", () => ({
    env: envMock,
}));

vi.mock("@/services/chatRoomService.ts", () => ({
    chatRoomService: {
        prepareDirectRoom: vi.fn(),
        loadMyRoomInvitation: vi.fn(),
        initializeGroupRoomEncryption: vi.fn(),
        respondToInvitation: vi.fn(),
    },
}));

vi.mock("@/services/e2eeService.ts", () => ({
    WAITING_FOR_SENDER_KEY: "WAITING_FOR_SENDER_KEY",
    e2eeService: {
        resolveDirectKey: vi.fn(),
        resolveMemberSenderKeys: vi.fn(),
    },
}));

vi.mock("@/services/wsService.ts", () => ({
    wsService: {
        on: vi.fn(),
        off: vi.fn(),
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

vi.mock("@/utils/logger.ts", () => ({
    logger: {
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock("sonner", () => ({
    toast: {
        error: vi.fn(),
    },
}));

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
};

const groupChat: ChatGroup = {
    id: "9",
    type: "group",
    name: "Crew",
};

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

describe("ChatRoom input and avatar behavior", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetChatStore();
        vi.mocked(chatRoomService.prepareDirectRoom).mockResolvedValue(undefined);
        vi.mocked(chatRoomService.loadMyRoomInvitation).mockResolvedValue({ found: false });
        vi.mocked(e2eeService.resolveDirectKey).mockResolvedValue(true);
        vi.mocked(chatRoomService.initializeGroupRoomEncryption).mockResolvedValue(undefined);
    });

    it("does not send on Enter while IME composition is confirming text", () => {
        const onSendMessage = vi.fn();
        render(<ChatRoom chat={botChat} messages={[]} onSendMessage={onSendMessage} />);

        const input = screen.getByPlaceholderText("Message Helper Bot...");
        fireEvent.change(input, { target: { value: "你好" } });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 229 });

        expect(onSendMessage).not.toHaveBeenCalled();
        expect(input).toHaveValue("你好");
    });

    it("sends on Enter when not composing", () => {
        const onSendMessage = vi.fn();
        render(<ChatRoom chat={botChat} messages={[]} onSendMessage={onSendMessage} />);

        const input = screen.getByPlaceholderText("Message Helper Bot...");
        fireEvent.change(input, { target: { value: "Hello" } });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });

        expect(onSendMessage).toHaveBeenCalledWith("Hello");
        expect(input).toHaveValue("");
    });

    it("keeps Shift+Enter as a newline gesture without sending", () => {
        const onSendMessage = vi.fn();
        render(<ChatRoom chat={botChat} messages={[]} onSendMessage={onSendMessage} />);

        const input = screen.getByPlaceholderText("Message Helper Bot...");
        fireEvent.change(input, { target: { value: "Hello" } });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13, shiftKey: true });

        expect(onSendMessage).not.toHaveBeenCalled();
        expect(input).toHaveValue("Hello");
    });

    it("uses the direct room avatar URL when one is available", () => {
        render(<ChatRoom chat={directChat} messages={[]} onSendMessage={vi.fn()} />);

        const avatar = screen.getByAltText("Luna Stone avatar");

        expect(avatar).toHaveAttribute("src", "http://api.test/static/avatars/luna.png");
    });

    it("renders a deleted direct room as unavailable and skips key initialization", () => {
        const onSendMessage = vi.fn();
        render(
            <ChatRoom
                chat={{ ...directChat, status: "deleted", name: "Deleted Contact" }}
                messages={[]}
                onSendMessage={onSendMessage}
            />,
        );

        const input = screen.getByPlaceholderText("This chat is no longer available.");
        expect(input).toBeDisabled();
        expect(screen.queryByAltText("Deleted Contact avatar")).not.toBeInTheDocument();
        expect(screen.getByText("Deleted")).toBeInTheDocument();

        fireEvent.change(input, { target: { value: "Hello" } });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });

        expect(onSendMessage).not.toHaveBeenCalled();
        expect(chatRoomService.prepareDirectRoom).not.toHaveBeenCalled();
    });

    it("renders a blocked-by-peer direct room as readonly without key initialization", () => {
        const onSendMessage = vi.fn();
        render(
            <ChatRoom
                chat={{ ...directChat, blockedByPeer: true }}
                messages={[]}
                onSendMessage={onSendMessage}
            />,
        );

        const input = screen.getByPlaceholderText("You have been blocked by this user.");
        expect(input).toBeDisabled();
        expect(screen.getAllByText("You have been blocked by this user.").length).toBeGreaterThan(0);
        expect(screen.queryByText("Chat is locked")).not.toBeInTheDocument();

        fireEvent.change(input, { target: { value: "Hello" } });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });

        expect(onSendMessage).not.toHaveBeenCalled();
        expect(chatRoomService.prepareDirectRoom).not.toHaveBeenCalled();
    });

    it("renders a blocked-by-me direct room as readonly without key initialization", () => {
        const onSendMessage = vi.fn();
        render(
            <ChatRoom
                chat={{ ...directChat, blockedByMe: true }}
                messages={[]}
                onSendMessage={onSendMessage}
            />,
        );

        const input = screen.getByPlaceholderText("You blocked this user.");
        expect(input).toBeDisabled();
        expect(screen.getAllByText("You blocked this user.").length).toBeGreaterThan(0);
        expect(screen.queryByText("Chat is locked")).not.toBeInTheDocument();

        fireEvent.change(input, { target: { value: "Hello" } });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });

        expect(onSendMessage).not.toHaveBeenCalled();
        expect(chatRoomService.prepareDirectRoom).not.toHaveBeenCalled();
    });

    it("renders a mutually blocked direct room with the neutral readonly copy", () => {
        render(
            <ChatRoom
                chat={{ ...directChat, blockedByMe: true, blockedByPeer: true }}
                messages={[]}
                onSendMessage={vi.fn()}
            />,
        );

        const input = screen.getByPlaceholderText("You cannot send messages in this conversation.");
        expect(input).toBeDisabled();
        expect(screen.getAllByText("You cannot send messages in this conversation.").length).toBeGreaterThan(0);
        expect(screen.queryByText("Chat is locked")).not.toBeInTheDocument();
        expect(chatRoomService.prepareDirectRoom).not.toHaveBeenCalled();
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
        }];

        render(<ChatRoom chat={groupChat} messages={messages} onSendMessage={vi.fn()} />);

        const avatar = screen.getByAltText("Mina Park avatar");
        expect(avatar).toHaveAttribute("src", "http://api.test/static/avatars/mina.png");
    });
});
