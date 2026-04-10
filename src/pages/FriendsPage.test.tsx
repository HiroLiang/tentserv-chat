import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { friendService } from "@/services/friendService.ts";
import { chatRoomService } from "@/services/chatRoomService.ts";
import { e2eeService } from "@/services/e2eeService.ts";
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
        getBlockedUsers: vi.fn(),
        getFriendRequests: vi.fn(),
        refreshFriendsPage: vi.fn(),
        acceptFriend: vi.fn(),
        rejectFriend: vi.fn(),
        cancelSentRequest: vi.fn(),
        unfriend: vi.fn(),
        blockUser: vi.fn(),
        unblockUser: vi.fn(),
    },
}));

vi.mock("@/services/chatRoomService.ts", () => ({
    chatRoomService: {
        createRoom: vi.fn(),
        initializeDirectRoomEncryption: vi.fn(),
        markRoomDeleted: vi.fn(),
    },
}));

vi.mock("@/services/e2eeService.ts", () => ({
    e2eeService: {
        deleteLocalSenderKeys: vi.fn(),
    },
}));

vi.mock("@/utils/logger.ts", () => ({
    logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
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
            blocked: [
                { friendship_id: 4, user_id: 604, name: "Blocked", avatar: "blocked.png", status: "blocked", created_at: "2026-01-04" },
            ],
        });
        vi.mocked(friendService.getFriendsTab).mockResolvedValue([
            { friendship_id: 1, user_id: 601, name: "Accepted", avatar: "accepted.png", status: "accepted", created_at: "2026-01-01" },
            { friendship_id: 2, user_id: 602, name: "Pending", avatar: "pending.png", status: "pending", created_at: "2026-01-02" },
        ]);
        vi.mocked(friendService.getBlockedUsers).mockResolvedValue([
            { friendship_id: 4, user_id: 604, name: "Blocked", avatar: "blocked.png", status: "blocked", created_at: "2026-01-04" },
        ]);
        vi.mocked(friendService.getFriendRequests).mockResolvedValue([
            { friendship_id: 3, user_id: 603, name: "Requester", avatar: "request.png", created_at: "2026-01-03" },
        ]);
        vi.mocked(friendService.acceptFriend).mockResolvedValue(undefined);
        vi.mocked(friendService.rejectFriend).mockResolvedValue({});
        vi.mocked(friendService.cancelSentRequest).mockResolvedValue(undefined);
        vi.mocked(friendService.unfriend).mockResolvedValue({
            deleted_direct_room: {
                room_id: 77,
                member_ids: [10, 11],
            },
        });
        vi.mocked(friendService.blockUser).mockResolvedValue(undefined);
        vi.mocked(friendService.unblockUser).mockResolvedValue(undefined);
        vi.mocked(e2eeService.deleteLocalSenderKeys).mockResolvedValue(undefined);
    });

    it("loads friends, requests, and blocked users on mount", async () => {
        renderPage();

        await waitFor(() => expect(friendService.refreshFriendsPage).toHaveBeenCalledTimes(1));
        expect(await screen.findByRole("button", { name: "Message" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
        expect(screen.getByText("Friends (2)")).toBeInTheDocument();
        expect(screen.getByText("Requests (1)")).toBeInTheDocument();
        expect(screen.getByText("Blocked (1)")).toBeInTheDocument();
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

        await user.click(screen.getByRole("button", { name: "Blocked (1)" }));
        expect(await screen.findByText("Blocked")).toBeInTheDocument();
        expect(friendService.getBlockedUsers).toHaveBeenCalledTimes(1);
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

    it("accepts and rejects incoming requests, then refreshes all lists", async () => {
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

    it("handles cancel, unfriend, block, and unblock actions", async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText("Accepted");
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        await user.click(screen.getByRole("button", { name: "Unfriend" }));
        expect(screen.getByRole("alertdialog")).toHaveTextContent("Remove Friend");
        await user.click(screen.getByRole("button", { name: "Remove" }));
        await waitFor(() => expect(friendService.unfriend).toHaveBeenCalledWith(1));
        await user.click(screen.getAllByRole("button", { name: "Block" })[0]);
        await user.click(screen.getByRole("button", { name: "Requests (1)" }));
        await user.click(screen.getByRole("button", { name: "Block" }));
        await user.click(screen.getByRole("button", { name: "Blocked (1)" }));
        await user.click(screen.getByRole("button", { name: "Unblock" }));

        expect(friendService.cancelSentRequest).toHaveBeenCalledWith(2);
        expect(chatRoomService.markRoomDeleted).toHaveBeenCalledWith(77);
        expect(e2eeService.deleteLocalSenderKeys).toHaveBeenCalledWith([10, 11]);
        expect(friendService.blockUser).toHaveBeenCalledWith(601);
        expect(friendService.blockUser).toHaveBeenCalledWith(603);
        expect(friendService.unblockUser).toHaveBeenCalledWith(604);
        await waitFor(() => expect(friendService.refreshFriendsPage).toHaveBeenCalledTimes(6));
    });

    it("does not unfriend when the confirmation dialog is cancelled", async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText("Accepted");
        await user.click(screen.getByRole("button", { name: "Unfriend" }));
        await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

        expect(friendService.unfriend).not.toHaveBeenCalled();
        expect(chatRoomService.markRoomDeleted).not.toHaveBeenCalled();
        expect(e2eeService.deleteLocalSenderKeys).not.toHaveBeenCalled();
    });
});
