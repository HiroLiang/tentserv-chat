import type { PresenceStatus, RoomType } from '@/types/chat.ts';

export const WAITING_FOR_PEER_KEY_LABEL = 'Missing peer key';
export const DIRECT_ROOM_WAITING_TITLE = 'Waiting for the other user to sign in and provide keys...';
export const DIRECT_ROOM_WAITING_HINT = 'Chat keys are not ready yet.';
export const DIRECT_ROOM_ONLINE_LABEL = 'Online';
export const DIRECT_ROOM_OFFLINE_LABEL = 'Offline';

export function getWaitingForSenderKeyPreview(roomType: RoomType, fallback: string): string {
    return roomType === 'direct' ? WAITING_FOR_PEER_KEY_LABEL : fallback;
}

export function formatDirectPresenceLabel(status?: PresenceStatus, lastSeenAt?: string, now = new Date()): string {
    if (status === 'online') {
        return DIRECT_ROOM_ONLINE_LABEL;
    }

    if (!lastSeenAt) {
        return DIRECT_ROOM_OFFLINE_LABEL;
    }

    const lastSeen = new Date(lastSeenAt);
    if (Number.isNaN(lastSeen.getTime())) {
        return DIRECT_ROOM_OFFLINE_LABEL;
    }

    const diffSeconds = Math.max(0, Math.round((now.getTime() - lastSeen.getTime()) / 1000));
    if (diffSeconds < 60) {
        return 'Last seen just now';
    }

    const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const units: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
        { unit: 'day', seconds: 60 * 60 * 24 },
        { unit: 'hour', seconds: 60 * 60 },
        { unit: 'minute', seconds: 60 },
    ];

    for (const { unit, seconds } of units) {
        if (diffSeconds >= seconds) {
            const value = -Math.round(diffSeconds / seconds);
            return `Last seen ${formatter.format(value, unit)}`;
        }
    }

    return DIRECT_ROOM_OFFLINE_LABEL;
}
