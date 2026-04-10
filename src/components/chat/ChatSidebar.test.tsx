import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
        unreadCount: 0,
        isOnline: true,
    }],
    group: [],
    channel: [],
    bot: [],
};

describe("ChatSidebar avatars", () => {
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
});
