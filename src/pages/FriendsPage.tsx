import { useState } from 'react';
import { Navbar } from '@/components/layout/Navbar.tsx';
import { cn } from '@/lib/utils';
import { mockFriends, mockFriendRequests } from '@/mock/friends.ts';
import type { MockFriend } from '@/mock/friends.ts';

type Tab = 'friends' | 'requests';

function getInitials(name: string) {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

function FriendRow({ friend, actionLabel }: { friend: MockFriend; actionLabel: string }) {
    return (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-accent transition-colors">
            <div className="relative flex-shrink-0">
                <div
                    className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
                    {getInitials(friend.name)}
                </div>
                <span className={cn(
                    'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background',
                    friend.isOnline ? 'bg-green-500' : 'bg-zinc-400',
                )}/>
            </div>
            <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{friend.name}</p>
                <p className="text-xs text-muted-foreground">
                    {friend.status === 'accepted' ? (friend.isOnline ? 'Online' : 'Offline') : 'Pending'}
                </p>
            </div>
            <button
                className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground">
                {actionLabel}
            </button>
        </div>
    );
}

export const FriendsPage = () => {
    const [activeTab, setActiveTab] = useState<Tab>('friends');

    return (
        <div className="flex flex-col h-screen overflow-hidden">
            <Navbar/>
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-2xl mx-auto px-4 py-6">
                    <h1 className="text-xl font-semibold mb-4">Friends</h1>

                    {/* Tabs */}
                    <div className="flex gap-1 border-b border-border mb-4">
                        {(['friends', 'requests'] as Tab[]).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={cn(
                                    'px-4 py-2 text-sm font-medium capitalize transition-colors',
                                    activeTab === tab
                                        ? 'border-b-2 border-primary text-foreground'
                                        : 'text-muted-foreground hover:text-foreground',
                                )}
                            >
                                {tab === 'friends' ? `Friends (${mockFriends.length})` : `Requests (${mockFriendRequests.length})`}
                            </button>
                        ))}
                    </div>

                    {/* List */}
                    <div className="space-y-1">
                        {activeTab === 'friends'
                            ? mockFriends.map(f => <FriendRow key={f.userId} friend={f} actionLabel="Message"/>)
                            : mockFriendRequests.map(f => <FriendRow key={f.userId} friend={f} actionLabel="Accept"/>)
                        }
                        {activeTab === 'friends' && mockFriends.length === 0 && (
                            <p className="text-center text-sm text-muted-foreground py-8">No friends yet</p>
                        )}
                        {activeTab === 'requests' && mockFriendRequests.length === 0 && (
                            <p className="text-center text-sm text-muted-foreground py-8">No pending requests</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
