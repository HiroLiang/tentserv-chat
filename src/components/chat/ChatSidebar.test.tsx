import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatSidebar } from "./ChatSidebar.tsx";
import type { ChatGroups } from "./ChatSidebar.tsx";

const envMock = vi.hoisted(() => ({
    API_BASE_URL: "http://api.test",
}));

vi.mock("@/config/env.ts", () => ({
    env: envMock,
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

const groups: ChatGroups = {
    direct: [{
        id: "12",
        type: "direct",
        name: "Mina Park",
        avatarUrl: "avatars/mina.png",
        lastMessage: "See you soon",
        lastMessageTime: "10:30",
        lastActivityAt: "2026-04-12T10:30:00Z",
        unreadCount: 0,
        isOnline: true,
    }],
    group: [],
    channel: [],
    bot: [],
};

describe("ChatSidebar avatars", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("uses the direct room avatar URL before falling back to initials", () => {
        render(
            <ChatSidebar
                chatGroups={groups}
                selectedChatId={null}
                onSelectChat={vi.fn()}
                collapsed={false}
                onToggleCollapse={vi.fn()}
            />,
        );

        expect(screen.getByAltText("Mina Park avatar"))
            .toHaveAttribute("src", "http://api.test/static/avatars/mina.png");
    });

    it("uses the deleted contact fallback without an online dot image", () => {
        render(
            <ChatSidebar
                chatGroups={{
                    ...groups,
                    direct: [{
                        ...groups.direct[0],
                        status: "deleted",
                        name: "Deleted Contact",
                    }],
                }}
                selectedChatId={null}
                onSelectChat={vi.fn()}
                collapsed={false}
                onToggleCollapse={vi.fn()}
            />,
        );

        expect(screen.getByText("Deleted Contact")).toBeInTheDocument();
        expect(screen.queryByAltText("Deleted Contact avatar")).not.toBeInTheDocument();
    });

    it("briefly marks a chat card as active when its latest activity changes", () => {
        vi.useFakeTimers();

        const { rerender } = render(
            <ChatSidebar
                chatGroups={groups}
                selectedChatId={null}
                onSelectChat={vi.fn()}
                collapsed={false}
                onToggleCollapse={vi.fn()}
            />,
        );

        const originalCard = screen.getByText("Mina Park").closest('[data-chat-card-id="12"]');
        expect(originalCard).toHaveAttribute("data-activity-state", "idle");

        rerender(
            <ChatSidebar
                chatGroups={{
                    ...groups,
                    direct: [{
                        ...groups.direct[0],
                        lastMessage: "Just now",
                        lastMessageTime: "10:31",
                        lastActivityAt: "2026-04-12T10:31:00Z",
                    }],
                }}
                selectedChatId={null}
                onSelectChat={vi.fn()}
                collapsed={false}
                onToggleCollapse={vi.fn()}
            />,
        );

        const activeCard = screen.getByText("Mina Park").closest('[data-chat-card-id="12"]');
        expect(activeCard).toHaveAttribute("data-activity-state", "active");

        act(() => {
            vi.advanceTimersByTime(421);
        });

        expect(screen.getByText("Mina Park").closest('[data-chat-card-id="12"]'))
            .toHaveAttribute("data-activity-state", "idle");
    });
});
