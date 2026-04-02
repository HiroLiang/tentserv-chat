import { chatApi, e2eeApi } from '@/api/index.ts';
import { useChatStore } from '@/stores/chatStore.ts';
import { useUserStore } from '@/stores/userStore.ts';
import { logger } from '@/utils/logger.ts';
import type { CreateRoomRequest, CreateRoomResponse, GetMyRoomInvitationResponse, SendMessageRequest } from '@/api/types.ts';
import { e2eeService } from '@/services/e2eeService.ts';
import { hasSenderKey } from '@/bridge/e2ee.ts';

class ChatRoomService {
    async loadRooms(): Promise<void> {
        const store = useChatStore.getState();
        store.setLoadingRooms(true);
        try {
            const rooms = await chatApi.getRooms();
            store.setRooms(rooms);
        } catch (err) {
            logger.error('Failed to load rooms', err);
            throw err;
        } finally {
            store.setLoadingRooms(false);
        }
    }

    async loadRoomDetail(roomId: number): Promise<void> {
        const store = useChatStore.getState();
        try {
            const detail = await chatApi.getRoomDetail(roomId);
            store.setRoomDetail(detail);
        } catch (err) {
            logger.error(`Failed to load room detail for ${roomId}`, err);
            throw err;
        }
    }

    async loadMessages(roomId: number, beforeId?: number): Promise<void> {
        const store = useChatStore.getState();
        store.setLoadingMessages(true);
        try {
            const { messages, has_more } = await chatApi.getMessages(roomId, beforeId);
            if (beforeId === undefined) {
                store.setMessages(roomId, messages, has_more);
            } else {
                store.prependMessages(roomId, messages, has_more);
            }
        } catch (err) {
            logger.error(`Failed to load messages for room ${roomId}`, err);
            throw err;
        } finally {
            store.setLoadingMessages(false);
        }
    }

    async sendMessage(roomId: number, content: string, type: SendMessageRequest['type'] = 'text'): Promise<void> {
        let finalContent = content;
        if (type === 'text') {
            try {
                finalContent = await e2eeService.encryptMessage(roomId, content);
            } catch (err) {
                logger.warn(`Sender key not found for room ${roomId}, sending plaintext`, err);
            }
        }
        try {
            await chatApi.sendMessage(roomId, { type, content: finalContent });
            this.markAsRead(roomId).catch(() => {});
        } catch (err) {
            logger.error(`Failed to send message to room ${roomId}`, err);
            throw err;
        }
    }

    async createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
        try {
            return await chatApi.createRoom(req);
        } catch (err) {
            logger.error('Failed to create room', err);
            throw err;
        }
    }

    async joinRoom(roomId: number): Promise<void> {
        try {
            await chatApi.joinRoom(roomId);
        } catch (err) {
            logger.error(`Failed to join room ${roomId}`, err);
            throw err;
        }
    }

    async markAsRead(roomId: number): Promise<void> {
        useChatStore.getState().clearUnreadCount(roomId);
        try {
            await chatApi.markAsRead(roomId);
        } catch (err) {
            logger.error(`Failed to mark room ${roomId} as read`, err);
            throw err;
        }
    }

    async loadMyRoomInvitation(roomId: number): Promise<GetMyRoomInvitationResponse | null> {
        const store = useChatStore.getState();
        try {
            const inv = await chatApi.getMyRoomInvitation(roomId);
            store.setPendingInvitation(inv.found ? inv : null);
            return inv;
        } catch (err) {
            logger.error(`Failed to load invitation for room ${roomId}`, err);
            store.setPendingInvitation(null);
            throw err;
        }
    }

    async initializeDirectRoomEncryption(roomId: number): Promise<void> {
        const userId = useUserStore.getState().currentUser?.id;
        if (!userId) return;

        const hasKey = await hasSenderKey(userId, roomId);
        if (hasKey) return;

        const detail = useChatStore.getState().currentRoomDetail;
        const myParticipantId = useUserStore.getState().participantId;
        const otherMembers = (detail?.members ?? []).filter(
            m => m.participant_id !== myParticipantId && m.user_id !== undefined
        );

        for (const member of otherMembers) {
            await e2eeService.performDirectKeyExchange(roomId, member.user_id!);
        }

        const status = await e2eeApi.getSenderKeyDistributionStatus(roomId);
        for (const memberID of (status?.pending_from_members ?? [])) {
            await e2eeApi.createSenderKeyRequest(roomId, memberID).catch(() => {});
        }

        logger.info(`Direct room E2EE initialized for room ${roomId}`);
    }

    async respondToInvitation(
        invId: number,
        action: 'accept' | 'reject' | 'block',
        ctx?: { roomId: number; roomType: string; inviterUserId?: number },
    ): Promise<void> {
        try {
            await chatApi.respondInvitation(invId, action);
            useChatStore.getState().setPendingInvitation(null);

            if (action === 'accept' && ctx?.roomType === 'direct' && ctx.inviterUserId !== undefined) {
                const store = useChatStore.getState();
                store.setDirectKeyStatus(ctx.roomId, 'loading');
                try {
                    // Upload invitee's sender key (encrypted with inviter's X3DH public keys).
                    await e2eeService.performDirectKeyExchange(ctx.roomId, ctx.inviterUserId);

                    // Check if inviter has already uploaded their sender key.
                    const unlocked = await e2eeService.resolveDirectKey(ctx.roomId);
                    store.setDirectKeyStatus(ctx.roomId, unlocked ? 'unlocked' : 'locked');

                    if (!unlocked) {
                        // Create a persistent request so the inviter is notified (even if offline).
                        try {
                            const status = await e2eeApi.getSenderKeyDistributionStatus(ctx.roomId);
                            for (const memberID of (status?.pending_from_members ?? [])) {
                                await e2eeApi.createSenderKeyRequest(ctx.roomId, memberID);
                            }
                        } catch (reqErr) {
                            logger.warn(`Failed to create sender key requests for room ${ctx.roomId}`, reqErr);
                        }
                    }
                } catch (e2eeErr) {
                    logger.error(`Direct key exchange failed for room ${ctx.roomId}`, e2eeErr);
                    store.setDirectKeyStatus(ctx.roomId, 'locked');
                }
            }
        } catch (err) {
            logger.error(`Failed to respond to invitation ${invId}`, err);
            throw err;
        }
    }
}

export const chatRoomService = new ChatRoomService();
