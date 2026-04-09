import { friendApi } from "@/api/friend.ts";
import type {
    FriendRequestResponse,
    FriendResponse,
    UserSearchResponse,
} from "@/api/types.ts";
import { useUserStore } from "@/stores/userStore.ts";

class FriendService {
    async getFriendsTab(): Promise<FriendResponse[]> {
        return friendApi.getFriends();
    }

    async getBlockedUsers(): Promise<FriendResponse[]> {
        return friendApi.getBlockedUsers();
    }

    async getFriendRequests(): Promise<FriendRequestResponse[]> {
        return friendApi.getFriendRequests();
    }

    async refreshFriendsPage(): Promise<{ friends: FriendResponse[]; requests: FriendRequestResponse[]; blocked: FriendResponse[] }> {
        const [friends, requests, blocked] = await Promise.all([
            this.getFriendsTab(),
            this.getFriendRequests(),
            this.getBlockedUsers(),
        ]);
        return { friends, requests, blocked };
    }

    async searchUsersByName(name: string): Promise<UserSearchResponse[]> {
        const currentUserID = useUserStore.getState().currentUser?.id;
        const results = await friendApi.searchUsers({ name });
        return results.filter((user) => user.user_id !== currentUserID);
    }

    async applyFriend(userID: number): Promise<void> {
        await friendApi.applyFriend(userID);
    }

    async acceptFriend(friendshipID: number): Promise<void> {
        await friendApi.acceptFriend(friendshipID);
    }

    async rejectFriend(friendshipID: number): Promise<void> {
        await friendApi.removeFriend(friendshipID);
    }

    async cancelSentRequest(friendshipID: number): Promise<void> {
        await friendApi.cancelSentRequest(friendshipID);
    }

    async unfriend(friendshipID: number): Promise<void> {
        await friendApi.removeFriend(friendshipID);
    }

    async blockUser(userID: number): Promise<void> {
        await friendApi.blockUser(userID);
    }

    async unblockUser(userID: number): Promise<void> {
        await friendApi.unblockUser(userID);
    }
}

export const friendService = new FriendService();
