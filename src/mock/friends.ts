export type FriendStatus = 'accepted' | 'pending';

export interface MockFriend {
    userId: number;
    name: string;
    status: FriendStatus;
    isOnline?: boolean;
}

export const mockFriends: MockFriend[] = [
    { userId: 1, name: 'Alice Chen', status: 'accepted', isOnline: true },
    { userId: 2, name: 'Bob Lin', status: 'accepted', isOnline: false },
    { userId: 3, name: 'Carol Wu', status: 'accepted', isOnline: true },
];

export const mockFriendRequests: MockFriend[] = [
    { userId: 4, name: 'Diana Liu', status: 'pending', isOnline: false },
    { userId: 5, name: 'Eric Ho', status: 'pending', isOnline: true },
];
