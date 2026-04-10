import { get, post, del } from '@/api/http.ts';
import type { FriendResponse, FriendRequestResponse, RemoveFriendResponse, SentFriendRequestResponse, UserSearchResponse } from '@/api/types.ts';

export const friendApi = {
    getFriends: () => get<FriendResponse[]>('/api/user/friends'),
    getBlockedUsers: () => get<FriendResponse[]>('/api/user/block'),
    getFriendRequests: () => get<FriendRequestResponse[]>('/api/user/friends/requests'),
    getSentRequests: () => get<SentFriendRequestResponse[]>('/api/user/friends/sent'),
    applyFriend: (friendId: number) => post('/api/user/friends/apply', { friend_id: friendId }),
    acceptFriend: (friendshipId: number) => post(`/api/user/friends/${friendshipId}/accept`),
    removeFriend: (friendshipId: number) => del<RemoveFriendResponse>(`/api/user/friends/${friendshipId}`),
    cancelSentRequest: (friendshipId: number) => del(`/api/user/friends/sent/${friendshipId}`),
    blockUser: (userId: number) => post(`/api/user/block/${userId}`),
    unblockUser: (userId: number) => del(`/api/user/block/${userId}`),
    searchUsers: (params: { name?: string; account?: string; public_id?: string }) =>
        get<UserSearchResponse[]>('/api/user/search', { params }),
};
