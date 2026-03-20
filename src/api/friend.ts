import { get, post, del } from '@/api/http.ts';
import type { FriendResponse, FriendRequestResponse, UserSearchResponse } from '@/api/types.ts';

export const friendApi = {
    getFriends: () => get<FriendResponse[]>('/api/user/friends'),
    getFriendRequests: () => get<FriendRequestResponse[]>('/api/user/friends/requests'),
    applyFriend: (friendId: number) => post('/api/user/friends/apply', { friend_id: friendId }),
    acceptFriend: (friendshipId: number) => post(`/api/user/friends/${friendshipId}/accept`),
    removeFriend: (friendshipId: number) => del(`/api/user/friends/${friendshipId}`),
    searchUsers: (params: { name?: string; account?: string; public_id?: string }) =>
        get<UserSearchResponse[]>('/api/user/search', { params }),
};
