import type { PresenceStatus, RoomType } from '@/types/chat.ts';

export const WAITING_FOR_SENDER_KEY_SENTINEL = '__E2EE_WAITING_KEY__';
export const LATEST_MESSAGE_FALLBACK = 'New message';
export const WAITING_FOR_PEER_KEY_LABEL = 'Waiting for the other person\'s key...';
export const DIRECT_ROOM_WAITING_TITLE = 'Setting up secure chat...';
export const DIRECT_ROOM_WAITING_HINT = 'This usually finishes automatically in a few moments.';
export const CHAT_RUNTIME_DEGRADED_MESSAGE = 'Live updates are temporarily delayed. Chats will keep refreshing automatically.';
export const CHAT_RUNTIME_UNAVAILABLE_MESSAGE = 'Chat is unavailable right now.';
export const DIRECT_ROOM_ONLINE_LABEL = 'Online';
export const DIRECT_ROOM_OFFLINE_LABEL = 'Offline';

export function getWaitingForSenderKeyPreview(roomType: RoomType, fallback: string): string {
    return roomType === 'direct' ? WAITING_FOR_PEER_KEY_LABEL : fallback;
}

export function normalizeRoomSummaryPreview(roomType: RoomType, latestMessage: string): string {
    if (latestMessage !== WAITING_FOR_SENDER_KEY_SENTINEL) {
        return latestMessage;
    }
    return getWaitingForSenderKeyPreview(roomType, LATEST_MESSAGE_FALLBACK);
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
