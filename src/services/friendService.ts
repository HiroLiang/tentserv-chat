import { friendApi } from "@/api/friend.ts";
import type {
    FriendRequestResponse,
    FriendResponse,
    FriendsOverviewResponse,
    RemoveFriendResponse,
    UserSearchResponse,
} from "@/api/types.ts";
import { useUserStore } from "@/stores/userStore.ts";

class FriendService {
    private refreshFriendsPageRequest: Promise<FriendsOverviewResponse> | null = null;

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
        if (!this.refreshFriendsPageRequest) {
            this.refreshFriendsPageRequest = friendApi.getFriendsOverview()
                .finally(() => {
                    this.refreshFriendsPageRequest = null;
                });
        }
        const overview = await this.refreshFriendsPageRequest;
        return {
            friends: overview.friends,
            requests: overview.requests,
            blocked: overview.blocked,
        };
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

    async rejectFriend(friendshipID: number): Promise<RemoveFriendResponse> {
        return friendApi.removeFriend(friendshipID);
    }

    async cancelSentRequest(friendshipID: number): Promise<void> {
        await friendApi.cancelSentRequest(friendshipID);
    }

    async unfriend(friendshipID: number): Promise<RemoveFriendResponse> {
        return friendApi.removeFriend(friendshipID);
    }

    async blockUser(userID: number): Promise<void> {
        await friendApi.blockUser(userID);
    }

    async unblockUser(userID: number): Promise<void> {
        await friendApi.unblockUser(userID);
    }
}

export const friendService = new FriendService();
