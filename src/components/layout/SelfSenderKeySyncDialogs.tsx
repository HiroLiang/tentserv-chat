import { useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useChatStore } from "@/stores/chatStore.ts";
import { e2eeService } from "@/services/e2eeService.ts";
import { userService } from "@/services/userService.ts";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { formatSelfSenderKeySyncStatusLabel } from "@/utils/chatCopy.ts";

const REQUESTER_BLOCKING_STATUSES = new Set(['pending_provider', 'syncing', 'failed']);

function formatRequestedAt(requestedAtMs?: number): string | null {
    if (!requestedAtMs) {
        return null;
    }

    try {
        return new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(new Date(requestedAtMs));
    } catch {
        return null;
    }
}

function RequesterBlockingDialog() {
    const navigate = useNavigate();
    const sync = useChatStore((state) => state.syncState?.self_sender_key_sync ?? null);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    if (!sync?.exists || !sync.requester_current_device || !REQUESTER_BLOCKING_STATUSES.has(sync.status)) {
        return null;
    }

    const title = sync.status === 'failed'
        ? 'Key sync needs attention'
        : sync.status === 'syncing'
            ? 'Syncing your secure keys'
            : 'Use a trusted device to sync your secure keys';
    const description = sync.status === 'failed'
        ? sync.last_error || 'Please open one of your already-trusted devices and retry the key sync flow.'
        : sync.status === 'syncing'
            ? 'A trusted device is securely sending the sender keys needed to unlock your older chats. Chat stays blocked until that finishes.'
            : 'Go back to one of your already signed-in devices and approve this key sync request. Until it finishes, this device cannot open older chats or decrypt message history.';

    const handleLogout = async () => {
        setIsLoggingOut(true);
        try {
            await userService.logout();
            navigate('/login', { replace: true });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to log out');
        } finally {
            setIsLoggingOut(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm">
            <div
                data-testid="self-sync-requester-blocker"
                className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl sm:p-8"
                role="dialog"
                aria-modal="true"
                aria-label="Self sender key sync status"
            >
                <div className="space-y-4">
                    <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            Secure Device Sync
                        </p>
                        <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
                        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-muted/40 p-4">
                        <div className="space-y-2 text-sm">
                            <div className="flex items-center justify-between gap-4">
                                <span className="text-muted-foreground">Requested device</span>
                                <span className="font-medium text-foreground">
                                    {sync.requester_device?.device_name ?? 'This device'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <span className="text-muted-foreground">Status</span>
                                <span className="font-medium text-foreground">
                                    {formatSelfSenderKeySyncStatusLabel(sync.status)}
                                </span>
                            </div>
                            {sync.provider_device?.device_name && (
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Trusted device</span>
                                    <span className="font-medium text-foreground">
                                        {sync.provider_device.device_name}
                                    </span>
                                </div>
                            )}
                            {formatRequestedAt(sync.requested_at_ms) && (
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Requested at</span>
                                    <span className="font-medium text-foreground">
                                        {formatRequestedAt(sync.requested_at_ms)}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={isLoggingOut}
                            onClick={() => void handleLogout()}
                        >
                            {isLoggingOut ? 'Logging out...' : 'Log out'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function RequesterUploadedNotice() {
    const sync = useChatStore((state) => state.syncState?.self_sender_key_sync ?? null);

    if (!sync?.exists || !sync.requester_current_device || sync.status !== 'uploaded') {
        return null;
    }

    return (
        <div className="pointer-events-none fixed inset-x-4 top-20 z-[60] flex justify-center sm:inset-x-auto sm:right-4 sm:left-auto sm:justify-end">
            <div
                data-testid="self-sync-uploaded-notice"
                className="pointer-events-auto w-full max-w-sm rounded-2xl border border-border/80 bg-card/95 p-4 shadow-xl backdrop-blur"
                role="status"
                aria-live="polite"
            >
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            Secure Device Sync
                        </p>
                        <h2 className="text-lg font-semibold text-foreground">Downloading your secure history</h2>
                        <p className="text-sm leading-6 text-muted-foreground">
                            A trusted device already uploaded this account&apos;s secure history. This device is
                            finishing local download and decryption in the background. If a specific chat still says
                            waiting for peer key, that room is still repairing peer sender keys separately.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                            {sync.requester_device?.device_name ?? 'This device'}
                        </span>
                        <span>{formatSelfSenderKeySyncStatusLabel(sync.status)}</span>
                        {sync.provider_device?.device_name && (
                            <span>Trusted device: {sync.provider_device.device_name}</span>
                        )}
                        {formatRequestedAt(sync.requested_at_ms) && (
                            <span>Requested {formatRequestedAt(sync.requested_at_ms)}</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function ProviderDecisionDialog() {
    const sync = useChatStore((state) => state.syncState?.self_sender_key_sync ?? null);
    const requestKey = (
        sync?.exists
            ? `${sync.requester_device?.device_id ?? 'unknown'}:${sync.requested_at_ms ?? 0}:${sync.status}`
            : null
    );
    const [dismissedKey, setDismissedKey] = useState<string | null>(null);
    const [isAccepting, setIsAccepting] = useState(false);

    useEffect(() => {
        if (!requestKey || dismissedKey === requestKey) {
            return;
        }

        if (sync?.status !== 'pending_provider') {
            setDismissedKey(null);
        }
    }, [dismissedKey, requestKey, sync?.status]);

    const open = Boolean(
        sync?.exists
        && sync.status === 'pending_provider'
        && !sync.requester_current_device
        && requestKey
        && dismissedKey !== requestKey,
    );

    if (!sync || !requestKey) {
        return null;
    }

    const handleAccept = async () => {
        setIsAccepting(true);
        try {
            await e2eeService.acceptSelfSenderKeySync();
            toast.success('Secure key sync started.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to start secure key sync');
        } finally {
            setIsAccepting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => {
            if (!nextOpen) {
                setDismissedKey(requestKey);
            }
        }}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Approve secure history sync</DialogTitle>
                    <DialogDescription>
                        Another device signed in to your account and is asking for your encrypted sender keys.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="rounded-xl border border-border/70 bg-muted/40 p-4">
                        <div className="grid gap-3 text-sm">
                            <div className="flex items-center justify-between gap-4">
                                <span className="text-muted-foreground">Device</span>
                                <span className="font-medium text-foreground">
                                    {sync.requester_device?.device_name ?? 'Unknown device'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <span className="text-muted-foreground">Platform</span>
                                <span className="font-medium text-foreground">
                                    {sync.requester_device?.platform ?? 'Unknown'}
                                </span>
                            </div>
                            {sync.requester_device?.last_ip && (
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">IP</span>
                                    <span className="font-medium text-foreground">
                                        {sync.requester_device.last_ip}
                                    </span>
                                </div>
                            )}
                            {formatRequestedAt(sync.requested_at_ms) && (
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Requested at</span>
                                    <span className="font-medium text-foreground">
                                        {formatRequestedAt(sync.requested_at_ms)}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    <p className="text-sm leading-6 text-muted-foreground">
                        If you trust this sign-in, approve the sync to upload the sender keys needed to decrypt your older chats on that device.
                    </p>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={isAccepting}
                        onClick={() => setDismissedKey(requestKey)}
                    >
                        Not now
                    </Button>
                    <Button
                        type="button"
                        disabled={isAccepting}
                        onClick={() => void handleAccept()}
                    >
                        {isAccepting ? 'Starting sync...' : 'Sync this device'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function SelfSenderKeySyncDialogs() {
    return (
        <>
            <RequesterBlockingDialog />
            <RequesterUploadedNotice />
            <ProviderDecisionDialog />
        </>
    );
}
