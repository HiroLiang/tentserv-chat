import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { PendingInvitation } from '@/types/chat';

interface InvitationBannerProps {
    invitation: PendingInvitation;
    onAccept: () => void;
    onReject: () => void;
    onBlock: () => void;
}

const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

export function InvitationBanner({ invitation, onAccept, onReject, onBlock }: InvitationBannerProps) {
    if (!invitation.found) return null;

    if (invitation.role === 'inviter') {
        return (
            <div className="flex-shrink-0 px-4 py-3 border-b border-border bg-amber-50 dark:bg-amber-950/20 flex items-center justify-center gap-2 text-sm text-amber-800 dark:text-amber-200">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
                Waiting for the other person to accept your invitation...
            </div>
        );
    }

    const initials = invitation.inviter_name ? getInitials(invitation.inviter_name) : '?';

    return (
        <div className="flex-shrink-0 px-4 py-3 border-b border-border bg-blue-50 dark:bg-blue-950/20">
            <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9 flex-shrink-0">
                    {invitation.inviter_avatar && (
                        <AvatarImage src={invitation.inviter_avatar} alt={invitation.inviter_name} />
                    )}
                    <AvatarFallback className="text-xs font-semibold">{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">
                        <span className="font-semibold">{invitation.inviter_name ?? 'Someone'}</span>{' '}
                        invited you to this group
                    </p>
                    <p className="text-xs text-muted-foreground">Respond to start chatting</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <Button size="sm" onClick={onAccept}>
                        Accept
                    </Button>
                    <Button size="sm" variant="outline" onClick={onReject}>
                        Reject
                    </Button>
                    <Button size="sm" variant="destructive" onClick={onBlock}>
                        Block
                    </Button>
                </div>
            </div>
        </div>
    );
}
