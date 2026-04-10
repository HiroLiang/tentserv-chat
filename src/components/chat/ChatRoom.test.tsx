import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatRoom } from "./ChatRoom.tsx";
import { chatRoomService } from "@/services/chatRoomService.ts";
import { e2eeService } from "@/services/e2eeService.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import type { ChatGroup } from "@/types/ui.ts";

const envMock = vi.hoisted(() => ({
    API_BASE_URL: "http://api.test",
}));

vi.mock("@/config/env.ts", () => ({
    env: envMock,
}));

vi.mock("@/services/chatRoomService.ts", () => ({
    chatRoomService: {
        loadMyRoomInvitation: vi.fn(),
        initializeDirectRoomEncryption: vi.fn(),
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
        vi.mocked(chatRoomService.loadMyRoomInvitation).mockResolvedValue({ found: false });
        vi.mocked(e2eeService.resolveDirectKey).mockResolvedValue(true);
        vi.mocked(chatRoomService.initializeDirectRoomEncryption).mockResolvedValue(undefined);
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
});
