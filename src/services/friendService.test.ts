import { beforeEach, describe, expect, it, vi } from "vitest";
import { friendApi } from "@/api/friend.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { friendService } from "./friendService.ts";

vi.mock("@/api/friend.ts", () => ({
    friendApi: {
        getFriends: vi.fn(),
        getFriendRequests: vi.fn(),
        searchUsers: vi.fn(),
        applyFriend: vi.fn(),
        acceptFriend: vi.fn(),
        removeFriend: vi.fn(),
    },
}));

describe("friendService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useUserStore.setState({
            currentUser: { id: 501, isLoggedIn: true },
            recordedUsers: new Map(),
            participantId: null,
        });
        vi.mocked(friendApi.getFriends).mockResolvedValue([
            { friendship_id: 1, user_id: 601, name: "Accepted", avatar: "accepted.png", status: "accepted", created_at: "2026-01-01" },
            { friendship_id: 2, user_id: 602, name: "Pending", avatar: "pending.png", status: "pending", created_at: "2026-01-02" },
        ]);
        vi.mocked(friendApi.getFriendRequests).mockResolvedValue([
            { friendship_id: 3, user_id: 603, name: "Request", avatar: "request.png", created_at: "2026-01-03" },
        ]);
        vi.mocked(friendApi.searchUsers).mockResolvedValue([
            { user_id: 501, name: "Hiro", avatar: "", account: "hiro", public_id: "hiro-public" },
            { user_id: 601, name: "Mina", avatar: "mina.png", account: "mina", public_id: "mina-public" },
        ]);
        vi.mocked(friendApi.applyFriend).mockResolvedValue(undefined);
        vi.mocked(friendApi.acceptFriend).mockResolvedValue(undefined);
        vi.mocked(friendApi.removeFriend).mockResolvedValue(undefined);
    });

    it("returns the friends tab payload from the backend service", async () => {
        const result = await friendService.getFriendsTab();

        expect(result).toEqual([
            { friendship_id: 1, user_id: 601, name: "Accepted", avatar: "accepted.png", status: "accepted", created_at: "2026-01-01" },
            { friendship_id: 2, user_id: 602, name: "Pending", avatar: "pending.png", status: "pending", created_at: "2026-01-02" },
        ]);
    });

    it("refreshes both friends and requests together", async () => {
        const result = await friendService.refreshFriendsPage();

        expect(result.friends).toHaveLength(2);
        expect(result.requests).toHaveLength(1);
    });

    it("filters the current user out of search results", async () => {
        const result = await friendService.searchUsersByName("mi");

        expect(friendApi.searchUsers).toHaveBeenCalledWith({ name: "mi" });
        expect(result).toEqual([
            { user_id: 601, name: "Mina", avatar: "mina.png", account: "mina", public_id: "mina-public" },
        ]);
    });

    it("delegates apply, accept, and reject mutations", async () => {
        await friendService.applyFriend(601);
        await friendService.acceptFriend(11);
        await friendService.rejectFriend(12);

        expect(friendApi.applyFriend).toHaveBeenCalledWith(601);
        expect(friendApi.acceptFriend).toHaveBeenCalledWith(11);
        expect(friendApi.removeFriend).toHaveBeenCalledWith(12);
    });
});
