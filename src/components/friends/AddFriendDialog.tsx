import { useEffect, useState } from 'react';
import { friendApi } from '@/api/friend.ts';
import type { UserSearchResponse } from '@/api/types.ts';
import { useUserStore } from '@/stores/userStore';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { env } from '@/config/env';

function getInitials(name: string) {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

interface AddFriendDialogProps {
    onClose: () => void;
}

export const AddFriendDialog = ({ onClose }: AddFriendDialogProps) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<UserSearchResponse[]>([]);
    const [loading, setLoading] = useState(false);
    const currentUser = useUserStore(s => s.currentUser);

    const search = async (q: string) => {
        if (!q.trim()) return;
        setLoading(true);
        try {
            const data = await friendApi.searchUsers({ name: q });
            setResults(data.filter(u => u.user_id !== currentUser?.id));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!query.trim()) { setResults([]); return; }
        const id = setTimeout(() => search(query), 600);
        return () => clearTimeout(id);
    }, [query]);

    const handleApply = async (userId: number) => {
        await friendApi.applyFriend(userId);
        setResults(prev => prev.map(u =>
            u.user_id === userId ? { ...u, friendship_status: 'pending' } : u
        ));
    };

    const handleClose = () => {
        setQuery('');
        setResults([]);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background rounded-lg shadow-lg w-full max-w-md mx-4 p-6">
                <h2 className="text-lg font-semibold mb-4">Add Friend</h2>
                <div className="flex gap-2 mb-4">
                    <input
                        type="text"
                        placeholder="Search by name..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && search(query)}
                        className="flex-1 px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                        onClick={() => search(query)}
                        disabled={loading}
                        className="text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                        Search
                    </button>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto">
                    {loading && (
                        <p className="text-center text-sm text-muted-foreground py-4">Searching...</p>
                    )}
                    {!loading && results.map(u => (
                        <div key={u.user_id} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent transition-colors">
                            <Avatar className="h-8 w-8 flex-shrink-0">
                                {u.avatar && (
                                    <AvatarImage
                                        src={`${env.API_BASE_URL}/static/${u.avatar}`}
                                        alt={u.name}
                                        className="object-cover"
                                    />
                                )}
                                <AvatarFallback className="text-xs font-semibold bg-primary text-primary-foreground">
                                    {getInitials(u.name)}
                                </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm truncate">{u.name}</p>
                                <p className="text-xs text-muted-foreground truncate">{u.public_id}</p>
                            </div>
                            {u.friendship_status === 'accepted' ? (
                                <button
                                    disabled
                                    className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground opacity-60 cursor-not-allowed"
                                >
                                    Friends
                                </button>
                            ) : u.friendship_status === 'pending' ? (
                                <button
                                    disabled
                                    className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground opacity-60 cursor-not-allowed"
                                >
                                    Applying
                                </button>
                            ) : (
                                <button
                                    onClick={() => handleApply(u.user_id)}
                                    className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                >
                                    Apply
                                </button>
                            )}
                        </div>
                    ))}
                    {!loading && results.length === 0 && query && (
                        <p className="text-center text-sm text-muted-foreground py-4">No users found</p>
                    )}
                </div>

                <div className="mt-4 flex justify-end">
                    <button
                        onClick={handleClose}
                        className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};
