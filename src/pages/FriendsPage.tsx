import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar.tsx';
import { cn } from '@/lib/utils';
import { chatRoomService } from '@/services/chatRoomService.ts';
import type { FriendResponse, FriendRequestResponse } from '@/api/types.ts';
import { AddFriendDialog } from '@/components/friends/AddFriendDialog.tsx';
import { ConfirmDialog } from '@/components/common/ConfirmDialog.tsx';
import { useE2eeStore } from '@/stores/e2eeStore.ts';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { env } from '@/config/env';
import { friendService } from '@/services/friendService.ts';
import { e2eeService } from '@/services/e2eeService.ts';
import { logger } from '@/utils/logger.ts';

type Tab = 'friends' | 'requests' | 'blocked';
type UserActionTarget = Pick<FriendResponse, 'user_id' | 'name'>;

let initialFriendsPageRefresh: Promise<void> | null = null;

function getInitials(name: string) {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

export const FriendsPage = () => {
    const navigate = useNavigate();
    const chatAvailable = useE2eeStore((state) => state.bootstrapStatus === 'ready');
    const [activeTab, setActiveTab] = useState<Tab>('friends');
    const [friends, setFriends] = useState<FriendResponse[]>([]);
    const [requests, setRequests] = useState<FriendRequestResponse[]>([]);
    const [blocked, setBlocked] = useState<FriendResponse[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const [showAddDialog, setShowAddDialog] = useState(false);
    const [unfriendTarget, setUnfriendTarget] = useState<FriendResponse | null>(null);
    const [blockTarget, setBlockTarget] = useState<UserActionTarget | null>(null);
    const [unblockTarget, setUnblockTarget] = useState<UserActionTarget | null>(null);
    const [unfriendLoading, setUnfriendLoading] = useState(false);
    const [blockLoading, setBlockLoading] = useState(false);
    const [unblockLoading, setUnblockLoading] = useState(false);
    const [loadingUserId, setLoadingUserId] = useState<number | null>(null);
    const [messageError, setMessageError] = useState<string | null>(null);

    const fetchFriends = async () => {
        const data = await friendService.getFriendsTab();
        setFriends(data);
    };

    const fetchRequests = async () => {
        const data = await friendService.getFriendRequests();
        setRequests(data);
    };

    const fetchBlocked = async () => {
        const data = await friendService.getBlockedUsers();
        setBlocked(data);
    };

    const refreshLists = async () => {
        const data = await friendService.refreshFriendsPage();
        setFriends(data.friends);
        setRequests(data.requests);
        setBlocked(data.blocked);
    };

    useEffect(() => {
        setLoading(true);
        if (!initialFriendsPageRefresh) {
            initialFriendsPageRefresh = refreshLists()
                .finally(() => {
                    initialFriendsPageRefresh = null;
                });
        }

        initialFriendsPageRefresh.finally(() => setLoading(false));
    }, []);

    const handleOpenDirect = async (friend: FriendResponse) => {
        if (!chatAvailable) {
            setMessageError('Chat is unavailable until end-to-end encryption is ready.');
            return;
        }

        setLoadingUserId(friend.user_id);
        setMessageError(null);
        try {
            const room = await chatRoomService.createRoom({
                type: 'direct',
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

    const handleAccept = async (friendshipId: number, friendUserId: number, friendName: string) => {
        await friendService.acceptFriend(friendshipId);
        await refreshLists();
        if (!chatAvailable) return;

        try {
            const room = await chatRoomService.createRoom({
                type: 'direct',
                name: friendName,
                member_ids: [friendUserId],
            });
            await chatRoomService.initializeDirectRoomEncryption(room.id);
        } catch {
            // best-effort; E2EE init failure should not block friendship acceptance
        }
    };

    const handleReject = async (friendshipId: number) => {
        await friendService.rejectFriend(friendshipId);
        await refreshLists();
    };

    const handleCancelSentRequest = async (friendshipId: number) => {
        await friendService.cancelSentRequest(friendshipId);
        await refreshLists();
    };

    const handleUnfriend = (friend: FriendResponse) => {
        setUnfriendTarget(friend);
    };

    const handleConfirmUnfriend = async () => {
        if (!unfriendTarget) return;

        setUnfriendLoading(true);
        try {
            const response = await friendService.unfriend(unfriendTarget.friendship_id);
            const deletedRoom = response.deleted_direct_room;
            if (deletedRoom?.room_id) {
                chatRoomService.markRoomDeleted(deletedRoom.room_id);
            }
            if (deletedRoom?.member_ids?.length) {
                await e2eeService.deleteLocalSenderKeys(deletedRoom.member_ids).catch((err) => {
                    logger.warn('Failed to delete local sender keys after unfriend', err);
                });
            }
            await refreshLists();
            setUnfriendTarget(null);
        } finally {
            setUnfriendLoading(false);
        }
    };

    const handleBlock = (target: UserActionTarget) => {
        setBlockTarget(target);
    };

    const handleConfirmBlock = async () => {
        if (!blockTarget) return;

        setBlockLoading(true);
        try {
            await friendService.blockUser(blockTarget.user_id);
            await refreshLists();
            setBlockTarget(null);
        } finally {
            setBlockLoading(false);
        }
    };

    const handleUnblock = (target: UserActionTarget) => {
        setUnblockTarget(target);
    };

    const handleConfirmUnblock = async () => {
        if (!unblockTarget) return;

        setUnblockLoading(true);
        try {
            await friendService.unblockUser(unblockTarget.user_id);
            await refreshLists();
            setUnblockTarget(null);
        } finally {
            setUnblockLoading(false);
        }
    };

    const filteredFriends = friends.filter(f =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const filteredRequests = requests.filter(r =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const filteredBlocked = blocked.filter(b =>
        b.name.toLowerCase().includes(searchQuery.toLowerCase())
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
                        {(['friends', 'requests', 'blocked'] as Tab[]).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => {
                                    setActiveTab(tab);
                                    setSearchQuery('');
                                    setMessageError(null);
                                    if (tab === 'friends') fetchFriends();
                                    else if (tab === 'requests') fetchRequests();
                                    else fetchBlocked();
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
                                    : tab === 'requests'
                                        ? `Requests (${requests.length})`
                                        : `Blocked (${blocked.length})`}
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
                                            {f.status === 'blocked' && f.blocked_by === 'them' ? (
                                                <button
                                                    disabled
                                                    className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground opacity-60 cursor-not-allowed"
                                                >
                                                    Blocked
                                                </button>
                                            ) : f.status === 'accepted' ? (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => handleOpenDirect(f)}
                                                        disabled={loadingUserId === f.user_id || !chatAvailable}
                                                        title={!chatAvailable
                                                            ? 'Chat is unavailable until end-to-end encryption is ready.'
                                                            : undefined}
                                                        className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {loadingUserId === f.user_id ? '...' : 'Message'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleUnfriend(f)}
                                                        className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground"
                                                    >
                                                        Unfriend
                                                    </button>
                                                    <button
                                                        onClick={() => handleBlock(f)}
                                                        className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground"
                                                    >
                                                        Block
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => handleCancelSentRequest(f.friendship_id)}
                                                        className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        onClick={() => handleBlock(f)}
                                                        className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground"
                                                    >
                                                        Block
                                                    </button>
                                                </div>
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
                                                    onClick={() => handleAccept(r.friendship_id, r.user_id, r.name)}
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
                                                <button
                                                    onClick={() => handleBlock(r)}
                                                    className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground"
                                                >
                                                    Block
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    {filteredRequests.length === 0 && (
                                        <p className="text-center text-sm text-muted-foreground py-8">No pending requests</p>
                                    )}
                                </>
                            )}

                            {activeTab === 'blocked' && (
                                <>
                                    {filteredBlocked.map(b => (
                                        <div
                                            key={b.friendship_id}
                                            className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-accent transition-colors"
                                        >
                                            <Avatar className="h-10 w-10 flex-shrink-0">
                                                <AvatarImage src={`${env.API_BASE_URL}/static/${b.avatar}`} />
                                                <AvatarFallback className="text-sm font-semibold bg-primary text-primary-foreground">
                                                    {getInitials(b.name)}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-sm truncate">{b.name}</p>
                                                <p className="text-xs text-muted-foreground capitalize">{b.status}</p>
                                            </div>
                                            <button
                                                onClick={() => handleUnblock(b)}
                                                className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground"
                                            >
                                                Unblock
                                            </button>
                                        </div>
                                    ))}
                                    {filteredBlocked.length === 0 && (
                                        <p className="text-center text-sm text-muted-foreground py-8">No blocked users</p>
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
                        void refreshLists();
                    }}
                />
            )}

            <ConfirmDialog
                open={unfriendTarget !== null}
                onOpenChange={(open) => {
                    if (!open && !unfriendLoading) setUnfriendTarget(null);
                }}
                title="Remove Friend"
                description="Are you sure you want to remove this friend?"
                actions={[
                    {
                        label: 'Cancel',
                        cancel: true,
                        disabled: unfriendLoading,
                    },
                    {
                        label: unfriendLoading ? 'Removing...' : 'Remove',
                        variant: 'destructive',
                        onClick: () => void handleConfirmUnfriend(),
                        disabled: unfriendLoading,
                    },
                ]}
            />
            <ConfirmDialog
                open={blockTarget !== null}
                onOpenChange={(open) => {
                    if (!open && !blockLoading) setBlockTarget(null);
                }}
                title="Block User"
                description={`Block ${blockTarget?.name ?? 'this user'}? They will not be able to find you or send you messages. Existing messages from them will be hidden.`}
                actions={[
                    {
                        label: 'Cancel',
                        cancel: true,
                        disabled: blockLoading,
                    },
                    {
                        label: blockLoading ? 'Blocking...' : 'Block',
                        variant: 'destructive',
                        onClick: () => void handleConfirmBlock(),
                        disabled: blockLoading,
                    },
                ]}
            />
            <ConfirmDialog
                open={unblockTarget !== null}
                onOpenChange={(open) => {
                    if (!open && !unblockLoading) setUnblockTarget(null);
                }}
                title="Unblock User"
                description={`Unblock ${unblockTarget?.name ?? 'this user'}? They may be able to find you and send you a friend request again.`}
                actions={[
                    {
                        label: 'Cancel',
                        cancel: true,
                        disabled: unblockLoading,
                    },
                    {
                        label: unblockLoading ? 'Unblocking...' : 'Unblock',
                        onClick: () => void handleConfirmUnblock(),
                        disabled: unblockLoading,
                    },
                ]}
            />
        </div>
    );
};
