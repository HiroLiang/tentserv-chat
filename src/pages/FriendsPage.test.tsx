import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { friendService } from "@/services/friendService.ts";
import { chatRoomService } from "@/services/chatRoomService.ts";
import { FriendsPage } from "./FriendsPage.tsx";

vi.mock("@/components/layout/Navbar.tsx", () => ({
    Navbar: () => <div data-testid="navbar" />,
}));

vi.mock("@/config/env.ts", () => ({
    env: {
        API_BASE_URL: "http://api.test",
        WS_BASE_URL: "ws://ws.test",
        IS_DEV: false,
    },
}));

vi.mock("@/services/friendService.ts", () => ({
    friendService: {
        getFriendsTab: vi.fn(),
        getFriendRequests: vi.fn(),
        refreshFriendsPage: vi.fn(),
        acceptFriend: vi.fn(),
        rejectFriend: vi.fn(),
    },
}));

vi.mock("@/services/chatRoomService.ts", () => ({
    chatRoomService: {
        createRoom: vi.fn(),
    },
}));

vi.mock("@/components/friends/AddFriendDialog.tsx", () => ({
    AddFriendDialog: ({ onClose }: { onClose: () => void }) => (
        <div>
            <span>Add Friend Dialog</span>
            <button onClick={onClose}>Close Dialog</button>
        </div>
    ),
}));

const renderPage = () =>
    render(
        <MemoryRouter>
            <FriendsPage />
        </MemoryRouter>,
    );

describe("FriendsPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(chatRoomService.createRoom).mockResolvedValue({
            id: 77,
            type: "direct",
            name: "Accepted",
            max_members: 2,
            allow_agent: false,
            created_at: "2026-01-01T00:00:00Z",
            already_existed: false,
        });
        vi.mocked(friendService.refreshFriendsPage).mockResolvedValue({
            friends: [
                { friendship_id: 1, user_id: 601, name: "Accepted", avatar: "accepted.png", status: "accepted", created_at: "2026-01-01" },
                { friendship_id: 2, user_id: 602, name: "Pending", avatar: "pending.png", status: "pending", created_at: "2026-01-02" },
            ],
            requests: [
                { friendship_id: 3, user_id: 603, name: "Requester", avatar: "request.png", created_at: "2026-01-03" },
            ],
        });
        vi.mocked(friendService.getFriendsTab).mockResolvedValue([
            { friendship_id: 1, user_id: 601, name: "Accepted", avatar: "accepted.png", status: "accepted", created_at: "2026-01-01" },
            { friendship_id: 2, user_id: 602, name: "Pending", avatar: "pending.png", status: "pending", created_at: "2026-01-02" },
        ]);
        vi.mocked(friendService.getFriendRequests).mockResolvedValue([
            { friendship_id: 3, user_id: 603, name: "Requester", avatar: "request.png", created_at: "2026-01-03" },
        ]);
        vi.mocked(friendService.acceptFriend).mockResolvedValue(undefined);
        vi.mocked(friendService.rejectFriend).mockResolvedValue(undefined);
    });

    it("loads friends and requests on mount and shows message/applying buttons", async () => {
        renderPage();

        await waitFor(() => expect(friendService.refreshFriendsPage).toHaveBeenCalledTimes(1));
        expect(await screen.findByRole("button", { name: "Message" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Applying" })).toBeDisabled();
        expect(screen.getByText("Friends (2)")).toBeInTheDocument();
        expect(screen.getByText("Requests (1)")).toBeInTheDocument();
    });

    it("refreshes the selected tab when switching tabs", async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText("Accepted");
        await user.click(screen.getByRole("button", { name: "Requests (1)" }));
        expect(await screen.findByText("Requester")).toBeInTheDocument();
        expect(friendService.getFriendRequests).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole("button", { name: "Friends (2)" }));
        expect(friendService.getFriendsTab).toHaveBeenCalledTimes(1);
    });

    it("refreshes both lists when the add-friend dialog closes", async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText("Accepted");
        await user.click(screen.getByRole("button", { name: "Add Friend" }));
        expect(screen.getByText("Add Friend Dialog")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Close Dialog" }));

        await waitFor(() => expect(friendService.refreshFriendsPage).toHaveBeenCalledTimes(2));
    });

    it("accepts and rejects incoming requests, then refreshes both lists", async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText("Accepted");
        await user.click(screen.getByRole("button", { name: "Requests (1)" }));
        await user.click(screen.getByRole("button", { name: "Accept" }));
        await user.click(screen.getByRole("button", { name: "Reject" }));

        expect(friendService.acceptFriend).toHaveBeenCalledWith(3);
        expect(friendService.rejectFriend).toHaveBeenCalledWith(3);
        await waitFor(() => expect(friendService.refreshFriendsPage).toHaveBeenCalledTimes(3));
    });
});
