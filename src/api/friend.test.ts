import { beforeEach, describe, expect, it, vi } from "vitest";
import { del, get, post } from "@/api/http.ts";
import { friendApi } from "./friend.ts";

vi.mock("@/api/http.ts", () => ({
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
}));

describe("friendApi", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(get).mockResolvedValue({});
        vi.mocked(post).mockResolvedValue({});
        vi.mocked(del).mockResolvedValue({});
    });

    it("requests friendship list endpoints from the expected paths", async () => {
        await friendApi.getFriends();
        await friendApi.getFriendsOverview();
        await friendApi.getBlockedUsers();
        await friendApi.getFriendRequests();
        await friendApi.getSentRequests();

        expect(get).toHaveBeenNthCalledWith(1, "/api/user/friends");
        expect(get).toHaveBeenNthCalledWith(2, "/api/user/friends/overview");
        expect(get).toHaveBeenNthCalledWith(3, "/api/user/block");
        expect(get).toHaveBeenNthCalledWith(4, "/api/user/friends/requests");
        expect(get).toHaveBeenNthCalledWith(5, "/api/user/friends/sent");
    });

    it("posts apply and accept payloads with the expected wire shape", async () => {
        await friendApi.applyFriend(601);
        await friendApi.acceptFriend(11);

        expect(post).toHaveBeenNthCalledWith(1, "/api/user/friends/apply", { friend_id: 601 });
        expect(post).toHaveBeenNthCalledWith(2, "/api/user/friends/11/accept");
    });

    it("deletes friendship and sent-request resources from the expected paths", async () => {
        await friendApi.removeFriend(11);
        await friendApi.cancelSentRequest(12);
        await friendApi.unblockUser(601);

        expect(del).toHaveBeenNthCalledWith(1, "/api/user/friends/11");
        expect(del).toHaveBeenNthCalledWith(2, "/api/user/friends/sent/12");
        expect(del).toHaveBeenNthCalledWith(3, "/api/user/block/601");
    });

    it("posts block payloads to the expected path", async () => {
        await friendApi.blockUser(601);

        expect(post).toHaveBeenCalledWith("/api/user/block/601");
    });

    it("searches users through the shared search endpoint", async () => {
        await friendApi.searchUsers({ name: "hiro" });

        expect(get).toHaveBeenCalledWith("/api/user/search", {
            params: { name: "hiro" },
        });
    });
});
