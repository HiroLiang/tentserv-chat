import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar.tsx';
import { cn } from '@/lib/utils';
import { friendApi } from '@/api/friend.ts';
import { chatRoomService } from '@/services/chatRoomService.ts';
import type { FriendResponse, FriendRequestResponse } from '@/api/types.ts';
import { AddFriendDialog } from '@/components/friends/AddFriendDialog.tsx';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { env } from '@/config/env';

type Tab = 'friends' | 'requests';

function getInitials(name: string) {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

export const FriendsPage = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<Tab>('friends');
    const [friends, setFriends] = useState<FriendResponse[]>([]);
    const [requests, setRequests] = useState<FriendRequestResponse[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const [showAddDialog, setShowAddDialog] = useState(false);
    const [loadingUserId, setLoadingUserId] = useState<number | null>(null);
    const [messageError, setMessageError] = useState<string | null>(null);

    const fetchFriends = async () => {
        const data = await friendApi.getFriends();
        setFriends(data);
    };

    const fetchRequests = async () => {
        const data = await friendApi.getFriendRequests();
        setRequests(data);
    };

    useEffect(() => {
        setLoading(true);
        Promise.all([fetchFriends(), fetchRequests()]).finally(() => setLoading(false));
    }, []);

    const handleOpenDirect = async (friend: FriendResponse) => {
        setLoadingUserId(friend.user_id);
        setMessageError(null);
        try {
            const room = await chatRoomService.createRoom({
                type: 'DIRECT',
                name: friend.name,
                member_ids: [friend.user_id],
            });
            navigate(`/chat?room_id=${room.id}`);
        } catch (err: any) {
            if (err.code === 'USER_BLOCKED') {
                setMessageError(`Cannot send a message to ${friend.name}.`);
            } else {
                setMessageError('Failed to open chat. Please try again.');
            }
        } finally {
            setLoadingUserId(null);
        }
    };

    const handleCancel = async (friendshipId: number) => {
        await friendApi.removeFriend(friendshipId);
        await Promise.all([fetchFriends(), fetchRequests()]);
    };

    const handleAccept = async (friendshipId: number) => {
        await friendApi.acceptFriend(friendshipId);
        await Promise.all([fetchFriends(), fetchRequests()]);
    };

    const handleReject = async (friendshipId: number) => {
        await friendApi.removeFriend(friendshipId);
        await Promise.all([fetchFriends(), fetchRequests()]);
    };

    const filteredFriends = friends.filter(f =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const filteredRequests = requests.filter(r =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="flex flex-col h-screen overflow-hidden">
            <Navbar/>
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-2xl mx-auto px-4 py-6">
                    <div className="flex items-center justify-between mb-4">
                        <h1 className="text-xl font-semibold">Friends</h1>
                        <button
                            onClick={() => setShowAddDialog(true)}
                            className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                            Add Friend
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 border-b border-border mb-4">
                        {(['friends', 'requests'] as Tab[]).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => {
                                    setActiveTab(tab);
                                    setSearchQuery('');
                                    setMessageError(null);
                                    if (tab === 'friends') fetchFriends();
                                    else fetchRequests();
                                }}
                                className={cn(
                                    'px-4 py-2 text-sm font-medium capitalize transition-colors',
                                    activeTab === tab
                                        ? 'border-b-2 border-primary text-foreground'
                                        : 'text-muted-foreground hover:text-foreground',
                                )}
                            >
                                {tab === 'friends'
                                    ? `Friends (${friends.length})`
                                    : `Requests (${requests.length})`}
                            </button>
                        ))}
                    </div>

                    {/* Search */}
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full mb-4 px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    />

                    {/* Error banner */}
                    {messageError && (
                        <div className="mb-3 flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
                            <span>{messageError}</span>
                            <button
                                onClick={() => setMessageError(null)}
                                className="text-destructive/70 hover:text-destructive transition-colors text-xs"
                            >
                                ✕
                            </button>
                        </div>
                    )}

                    {/* List */}
                    {loading ? (
                        <p className="text-center text-sm text-muted-foreground py-8">Loading...</p>
                    ) : (
                        <div className="space-y-1">
                            {activeTab === 'friends' && (
                                <>
                                    {filteredFriends.map(f => (
                                        <div
                                            key={f.friendship_id}
                                            className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-accent transition-colors"
                                        >
                                            <Avatar className="h-10 w-10 flex-shrink-0">
                                                <AvatarImage src={`${env.API_BASE_URL}/static/${f.avatar}`} />
                                                <AvatarFallback className="text-sm font-semibold bg-primary text-primary-foreground">
                                                    {getInitials(f.name)}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-sm truncate">{f.name}</p>
                                                <p className="text-xs text-muted-foreground capitalize">{f.status}</p>
                                            </div>
                                            {f.status === 'accepted' ? (
                                                <button
                                                    onClick={() => handleOpenDirect(f)}
                                                    disabled={loadingUserId === f.user_id}
                                                    className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {loadingUserId === f.user_id ? '...' : 'Message'}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handleCancel(f.friendship_id)}
                                                    className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground"
                                                >
                                                    Cancel
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    {filteredFriends.length === 0 && (
                                        <p className="text-center text-sm text-muted-foreground py-8">No friends yet</p>
                                    )}
                                </>
                            )}

                            {activeTab === 'requests' && (
                                <>
                                    {filteredRequests.map(r => (
                                        <div
                                            key={r.friendship_id}
                                            className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-accent transition-colors"
                                        >
                                            <Avatar className="h-10 w-10 flex-shrink-0">
                                                <AvatarImage src={`${env.API_BASE_URL}/static/${r.avatar}`} />
                                                <AvatarFallback className="text-sm font-semibold bg-primary text-primary-foreground">
                                                    {getInitials(r.name)}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-sm truncate">{r.name}</p>
                                                <p className="text-xs text-muted-foreground">Sent you a request</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleAccept(r.friendship_id)}
                                                    className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                                >
                                                    Accept
                                                </button>
                                                <button
                                                    onClick={() => handleReject(r.friendship_id)}
                                                    className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground"
                                                >
                                                    Reject
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    {filteredRequests.length === 0 && (
                                        <p className="text-center text-sm text-muted-foreground py-8">No pending requests</p>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showAddDialog && (
                <AddFriendDialog
                    onClose={() => {
                        setShowAddDialog(false);
                        Promise.all([fetchFriends(), fetchRequests()]);
                    }}
                />
            )}
        </div>
    );
};
