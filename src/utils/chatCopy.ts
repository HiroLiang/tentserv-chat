import type { PresenceStatus, RoomType } from '@/types/chat.ts';

export const WAITING_FOR_SENDER_KEY_SENTINEL = '__E2EE_WAITING_KEY__';
export const WAITING_FOR_SENDER_KEY_LABEL = 'Waiting for peer key';
export const LATEST_MESSAGE_FALLBACK = 'New message';
export const WAITING_FOR_PEER_KEY_LABEL = WAITING_FOR_SENDER_KEY_LABEL;
export const DIRECT_ROOM_WAITING_TITLE = 'Finishing secure setup...';
export const DIRECT_ROOM_WAITING_HINT = 'You\'ll be able to chat as soon as your keys finish syncing.';
export const CHAT_RUNTIME_DEGRADED_MESSAGE = 'Live updates are temporarily delayed. Chats will keep refreshing automatically.';
export const CHAT_RUNTIME_UNAVAILABLE_MESSAGE = 'Chat is unavailable right now.';
export const DIRECT_ROOM_ONLINE_LABEL = 'Online';
export const DIRECT_ROOM_OFFLINE_LABEL = 'Offline';

export function getWaitingForSenderKeyPreview(roomType: RoomType, fallback: string): string {
    void roomType;
    void fallback;
    return WAITING_FOR_SENDER_KEY_LABEL;
}

export function normalizeRoomSummaryPreview(roomType: RoomType, latestMessage: string): string {
    if (latestMessage !== WAITING_FOR_SENDER_KEY_SENTINEL) {
        return latestMessage;
    }
    return getWaitingForSenderKeyPreview(roomType, LATEST_MESSAGE_FALLBACK);
}

export function resolveRoomDisplayName(roomType: RoomType, displayName?: string): string {
    if (displayName && displayName.trim().length > 0) {
        return displayName.trim();
    }

    switch (roomType) {
        case 'direct':
            return 'Direct chat';
        case 'group':
            return 'Group chat';
        case 'channel':
            return 'Channel';
        case 'bot':
        default:
            return 'Assistant';
    }
}

export function formatSelfSenderKeySyncStatusLabel(status?: string): string {
    switch (status) {
        case 'pending_provider':
            return 'Waiting for a trusted device';
        case 'syncing':
            return 'Uploading secure keys';
        case 'uploaded':
            return 'Downloading secure history';
        case 'completed':
            return 'Ready';
        case 'failed':
            return 'Needs attention';
        default:
            return 'Checking secure sync';
    }
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
