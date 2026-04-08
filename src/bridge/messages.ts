import { invoke } from '@tauri-apps/api/core';

type BridgeId = string | number;

const toBridgeId = (value: BridgeId): string => String(value);

export interface EncryptedMessageRow {
    message_id: string;
    room_id: string;
    sender_id: string;
    encrypted_content: number[];
    message_type: string;
    spk_key_id?: number;
    otpk_key_id?: number;
    server_timestamp: number;
    received_at: number;
}

export interface DecryptedMessageRow {
    message_id: string;
    room_id: string;
    sender_id: string;
    plaintext: number[];
    content_type: string;
    message_timestamp: number;
    reply_to_id: string | null;
    is_edited: boolean;
    is_deleted: boolean;
}

export interface StoreEncryptedMessageInput {
    messageId: BridgeId;
    roomId: BridgeId;
    senderId: BridgeId;
    encryptedContent: number[];
    messageType: string;
    spkKeyId?: number;
    otpkKeyId?: number;
    serverTimestamp: number;
}

export interface StoreDecryptedMessageInput {
    userId: BridgeId;
    messageId: BridgeId;
    roomId: BridgeId;
    senderId: BridgeId;
    plaintext: number[];
    contentType: string;
    messageTimestamp: number;
    replyToId?: string;
    isEdited: boolean;
    isDeleted: boolean;
}

export const storeEncryptedMessage = ({
    messageId,
    roomId,
    senderId,
    encryptedContent,
    messageType,
    spkKeyId,
    otpkKeyId,
    serverTimestamp,
}: StoreEncryptedMessageInput): Promise<void> =>
    invoke('store_encrypted_message', {
        messageId: toBridgeId(messageId),
        roomId: toBridgeId(roomId),
        senderId: toBridgeId(senderId),
        encryptedContent,
        messageType,
        ...(spkKeyId !== undefined && { spkKeyId }),
        ...(otpkKeyId !== undefined && { otpkKeyId }),
        serverTimestamp,
    });

export const getEncryptedMessages = (
    roomId: BridgeId,
    limit: number,
    beforeTimestamp?: number,
): Promise<EncryptedMessageRow[]> =>
    invoke<EncryptedMessageRow[]>('get_encrypted_messages', {
        roomId: toBridgeId(roomId),
        limit,
        ...(beforeTimestamp !== undefined && { beforeTimestamp }),
    });

export const storeDecryptedMessage = ({
    userId,
    messageId,
    roomId,
    senderId,
    plaintext,
    contentType,
    messageTimestamp,
    replyToId,
    isEdited,
    isDeleted,
}: StoreDecryptedMessageInput): Promise<void> =>
    invoke('store_decrypted_message', {
        userId: toBridgeId(userId),
        messageId: toBridgeId(messageId),
        roomId: toBridgeId(roomId),
        senderId: toBridgeId(senderId),
        plaintext,
        contentType,
        messageTimestamp,
        replyToId: replyToId ?? null,
        isEdited,
        isDeleted,
    });

export const getDecryptedMessages = (
    userId: BridgeId,
    roomId: BridgeId,
    limit: number,
    beforeTimestamp?: number,
): Promise<DecryptedMessageRow[]> =>
    invoke<DecryptedMessageRow[]>('get_decrypted_messages', {
        userId: toBridgeId(userId),
        roomId: toBridgeId(roomId),
        limit,
        ...(beforeTimestamp !== undefined && { beforeTimestamp }),
    });
