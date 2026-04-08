import { chatApi, e2eeApi } from '@/api/index.ts';
import { useChatStore } from '@/stores/chatStore.ts';
import { useUserStore } from '@/stores/userStore.ts';
import { useE2eeStore } from '@/stores/e2eeStore.ts';
import { logger } from '@/utils/logger.ts';
import type { CreateRoomRequest, CreateRoomResponse, GetMyRoomInvitationResponse, SendMessageRequest } from '@/api/types.ts';
import { e2eeService } from '@/services/e2eeService.ts';
import { hasSenderKey } from '@/bridge/e2ee.ts';

// [EN] ChatRoomService manages chat room CRUD, message loading/sending (with E2EE encryption),
//      invitation handling, and direct-room E2EE key initialization.
// [中] ChatRoomService 負責聊天室 CRUD、訊息載入/傳送（含 E2EE 加密）、邀請處理及直接聊天室 E2EE 金鑰初始化。
// [日] ChatRoomService はチャットルームの CRUD、メッセージ読み込み/送信（E2EE 暗号化含む）、
//      招待処理、ダイレクトルーム E2EE 鍵の初期化を担当する。
class ChatRoomService {
    private resolveCurrentMemberId(roomId: number): number | null {
        const roomDetail = useChatStore.getState().currentRoomDetail;
        const participantId = useUserStore.getState().participantId;
        if (!roomDetail || roomDetail.room_id !== roomId || participantId === null) {
            return null;
        }

        const me = roomDetail.members.find((m) => m.participant_id === participantId);
        return me?.member_id ?? null;
    }

    private resolveRoomType(roomId: number): string | undefined {
        const store = useChatStore.getState();
        if (store.currentRoomDetail?.room_id === roomId) {
            return store.currentRoomDetail.room_type;
        }
        if (store.rooms.direct.some(r => r.room_id === roomId)) return 'direct';
        if (store.rooms.group.some(r => r.room_id === roomId)) return 'group';
        if (store.rooms.channel.some(r => r.room_id === roomId)) return 'channel';
        if (store.rooms.bot.some(r => r.room_id === roomId)) return 'bot';
        return undefined;
    }

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
            const decryptAll = (msgs: typeof messages) =>
                Promise.all(msgs.map(async m => ({
                    ...m,
                    content: await e2eeService.decryptMessage(m.content, m.sender_id).catch(() => m.content),
                })));
            const decrypted = await decryptAll(messages);
            if (beforeId === undefined) {
                store.setMessages(roomId, decrypted, has_more);
            } else {
                store.prependMessages(roomId, decrypted, has_more);
            }
        } catch (err) {
            logger.error(`Failed to load messages for room ${roomId}`, err);
            throw err;
        } finally {
            store.setLoadingMessages(false);
        }
    }

    // [EN] sendMessage: encrypts direct/group text with the room's sender key,
    //      then sends via REST API and marks the room as read.
    // [中] sendMessage：direct/group 文字訊息必須用房間 sender key 加密，再透過 REST API 傳送並標記已讀。
    async sendMessage(roomId: number, content: string, type: SendMessageRequest['type'] = 'text'): Promise<void> {
        let finalContent = content;
        if (type === 'text') {
            try {
                const memberId = this.resolveCurrentMemberId(roomId);
                if (memberId === null) {
                    throw new Error(`Cannot resolve member id for room ${roomId}`);
                }
                finalContent = await e2eeService.encryptMessage(roomId, content, memberId);
            } catch (err) {
                const roomType = this.resolveRoomType(roomId);
                if (roomType === 'direct' || roomType === 'group') {
                    logger.error(`Sender key not ready for encrypted room ${roomId}; refusing plaintext send`, err);
                    throw new Error('Message encryption is not ready for this room');
                }
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

    // [EN] initializeDirectRoomEncryption: ensures both local and backend sender-key state exist,
    //      then creates sender key requests for members whose keys are still missing locally.
    // [中] initializeDirectRoomEncryption：確認本地與後端 sender key 狀態都存在，
    //      並為本地仍缺少 sender key 的成員建立請求。
    async initializeDirectRoomEncryption(roomId: number): Promise<void> {
        const userId = useUserStore.getState().currentUser?.id;
        if (!userId) return;

        const chatStore = useChatStore.getState();
        chatStore.setDirectKeyStatus(roomId, 'loading');

        try {
            if (!useChatStore.getState().currentRoomDetail || useChatStore.getState().currentRoomDetail?.room_id !== roomId) {
                await this.loadRoomDetail(roomId);
            }

            const myMemberId = this.resolveCurrentMemberId(roomId);
            if (myMemberId === null) {
                logger.warn(`Cannot initialize E2EE for room ${roomId}: missing member id`);
                chatStore.setDirectKeyStatus(roomId, 'locked');
                return;
            }

            const statusBefore = await e2eeApi.getSenderKeyDistributionStatus(roomId);
            const hasLocalKey = await hasSenderKey(userId, myMemberId).catch(() => false);

            if (!(hasLocalKey && statusBefore.own_sender_key_exists)) {
                const detail = useChatStore.getState().currentRoomDetail;
                const myParticipantId = useUserStore.getState().participantId;
                const otherMembers = (detail?.members ?? []).filter(
                    m => m.participant_id !== myParticipantId && m.user_id !== undefined
                );

                for (const member of otherMembers) {
                    await e2eeService.performDirectKeyExchange(roomId, member.user_id!, myMemberId);
                }
            }

            await e2eeService.resolveMemberSenderKeys(roomId).catch(err =>
                logger.warn(`Failed to resolve direct sender keys for room ${roomId}`, err)
            );

            const status = await e2eeApi.getSenderKeyDistributionStatus(roomId);
            const e2eeStore = useE2eeStore.getState();
            for (const memberID of (status?.pending_from_members ?? [])) {
                if (e2eeStore.hasSenderKeyRequest(roomId, memberID)) continue;
                e2eeStore.addSenderKeyRequest(roomId, memberID);
                await e2eeApi.createSenderKeyRequest(roomId, memberID).catch(() => {});
            }

            const unlocked = await e2eeService.resolveDirectKey(roomId).catch(() => false);
            chatStore.setDirectKeyStatus(roomId, unlocked ? 'unlocked' : 'locked');
            logger.info(`Direct room E2EE initialized for room ${roomId}`);
        } catch (err) {
            chatStore.setDirectKeyStatus(roomId, 'locked');
            throw err;
        }
    }

    // [EN] initializeGroupRoomEncryption: checks for missing sender keys in the room,
    //      sends requests for any pending members, and fetches available keys into local storage.
    // [中] initializeGroupRoomEncryption：檢查房間內缺少的 sender key，
    //      對待處理成員建立請求，並將已有的 sender key 存入本地。
    async initializeGroupRoomEncryption(roomId: number): Promise<void> {
        const status = await e2eeApi.getSenderKeyDistributionStatus(roomId);
        const e2eeStore = useE2eeStore.getState();
        for (const memberID of (status?.pending_from_members ?? [])) {
            if (e2eeStore.hasSenderKeyRequest(roomId, memberID)) continue;
            e2eeStore.addSenderKeyRequest(roomId, memberID);
            await e2eeApi.createSenderKeyRequest(roomId, memberID).catch(() => {});
        }
        await e2eeService.resolveMemberSenderKeys(roomId).catch(err =>
            logger.warn(`Failed to resolve group sender keys for room ${roomId}`, err)
        );
        logger.info(`Group room E2EE initialized for room ${roomId}`);
    }

    async respondToInvitation(
        invId: number,
        action: 'accept' | 'reject' | 'block',
        ctx?: { roomId: number; roomType: string; inviterUserId?: number },
    ): Promise<void> {
        try {
            const response = await chatApi.respondInvitation(invId, action);
            useChatStore.getState().setPendingInvitation(null);

            if (action === 'accept' && ctx?.roomType === 'group' && ctx.roomId !== undefined) {
                this.initializeGroupRoomEncryption(ctx.roomId).catch(err =>
                    logger.error(`Group E2EE init failed for room ${ctx.roomId}`, err)
                );
            }

            if (action === 'accept' && ctx?.roomType === 'direct' && ctx.inviterUserId !== undefined) {
                const store = useChatStore.getState();
                store.setDirectKeyStatus(ctx.roomId, 'loading');
                try {
                    const memberId = response.member_id ?? this.resolveCurrentMemberId(ctx.roomId) ?? undefined;
                    // Upload invitee's sender key (encrypted with inviter's X3DH public keys).
                    await e2eeService.performDirectKeyExchange(ctx.roomId, ctx.inviterUserId, memberId);

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
