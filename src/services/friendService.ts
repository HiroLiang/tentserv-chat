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

    async getFriendRequests(): Promise<FriendRequestResponse[]> {
        return friendApi.getFriendRequests();
    }

    async refreshFriendsPage(): Promise<{ friends: FriendResponse[]; requests: FriendRequestResponse[] }> {
        const [friends, requests] = await Promise.all([
            this.getFriendsTab(),
            this.getFriendRequests(),
        ]);
        return { friends, requests };
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
}

export const friendService = new FriendService();
