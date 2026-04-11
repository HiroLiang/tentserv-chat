import { chatApi } from '@/api/index.ts';
import { useChatStore } from '@/stores/chatStore.ts';
import { useUserStore } from '@/stores/userStore.ts';
import { useE2eeStore } from '@/stores/e2eeStore.ts';
import { logger } from '@/utils/logger.ts';
import { getWaitingForSenderKeyPreview } from '@/utils/chatCopy.ts';
import type { CreateRoomRequest, CreateRoomResponse, GetMyRoomInvitationResponse, SendMessageRequest } from '@/api/types.ts';
import { e2eeService, WAITING_FOR_SENDER_KEY } from '@/services/e2eeService.ts';
import type { GetUserRoomsResponse, Message, RoomDetail, RoomSummary } from '@/types/chat.ts';

export const LATEST_MESSAGE_FALLBACK = 'New message';
type DirectRoomBlockState = 'none' | 'blocked_by_me' | 'blocked_by_peer' | 'blocked_both';
type LoadRoomDetailOptions = { persist?: boolean; hydrateMessages?: boolean };

// [EN] ChatRoomService manages chat room CRUD, message loading/sending (with E2EE encryption),
//      invitation handling, and direct-room E2EE key initialization.
// [中] ChatRoomService 負責聊天室 CRUD、訊息載入/傳送（含 E2EE 加密）、邀請處理及直接聊天室 E2EE 金鑰初始化。
// [日] ChatRoomService はチャットルームの CRUD、メッセージ読み込み/送信（E2EE 暗号化含む）、
//      招待処理、ダイレクトルーム E2EE 鍵の初期化を担当する。
class ChatRoomService {
    private _directRoomOpenPromises = new Map<number, Promise<void>>();
    private _directRoomInitPromises = new Map<number, Promise<void>>();
    private _roomDetailFetchPromises = new Map<number, Promise<RoomDetail>>();

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

    private isRoomDeleted(roomId: number): boolean {
        const store = useChatStore.getState();
        if (store.currentRoomDetail?.room_id === roomId) {
            return store.currentRoomDetail.status === 'deleted';
        }
        return [
            ...store.rooms.direct,
            ...store.rooms.group,
            ...store.rooms.channel,
            ...store.rooms.bot,
        ].some(room => room.room_id === roomId && room.status === 'deleted');
    }

    private resolveDirectRoomBlockState(roomId: number, roomDetail?: RoomDetail): DirectRoomBlockState {
        const store = useChatStore.getState();
        const currentRoomDetail = store.currentRoomDetail?.room_id === roomId
            ? store.currentRoomDetail
            : null;
        const summary = store.rooms.direct.find(room => room.room_id === roomId);
        const blockedByPeer = roomDetail?.blocked_by_peer === true
            || currentRoomDetail?.blocked_by_peer === true
            || summary?.blocked_by_peer === true;
        const blockedByMe = roomDetail?.blocked_by_me === true
            || currentRoomDetail?.blocked_by_me === true
            || summary?.blocked_by_me === true;

        if (blockedByPeer && blockedByMe) return 'blocked_both';
        if (blockedByPeer) return 'blocked_by_peer';
        if (blockedByMe) return 'blocked_by_me';
        return 'none';
    }

    private isDirectRoomBlocked(roomId: number, roomDetail?: RoomDetail): boolean {
        return this.resolveDirectRoomBlockState(roomId, roomDetail) !== 'none';
    }

    private blockedDirectRoomError(roomId: number, roomDetail?: RoomDetail): Error {
        const state = this.resolveDirectRoomBlockState(roomId, roomDetail);
        switch (state) {
            case 'blocked_by_me':
                return new Error('You blocked this user.');
            case 'blocked_by_peer':
                return new Error('You have been blocked by this user.');
            case 'blocked_both':
                return new Error('You cannot send messages in this conversation.');
            default:
                return new Error('You cannot send messages in this conversation.');
        }
    }

    private async ensureRoomDetail(roomId: number, roomDetail?: RoomDetail, persist = true): Promise<RoomDetail> {
        if (roomDetail) {
            if (persist) {
                useChatStore.getState().setRoomDetail(roomDetail);
            }
            return roomDetail;
        }

        const current = useChatStore.getState().currentRoomDetail;
        if (current?.room_id === roomId) {
            return current;
        }

        return this.loadRoomDetail(roomId, { persist });
    }

    async loadRooms(): Promise<void> {
        const store = useChatStore.getState();
        store.setLoadingRooms(true);
        try {
            const rooms = await chatApi.getRooms();
            store.setRooms(await this.decryptRoomSummaries(rooms));
        } catch (err) {
            logger.error('Failed to load rooms', err);
            throw err;
        } finally {
            store.setLoadingRooms(false);
        }
    }

    private async decryptRoomSummaries(rooms: GetUserRoomsResponse): Promise<GetUserRoomsResponse> {
        return {
            direct: await this.decryptRoomSummaryList(rooms.direct),
            group: await this.decryptRoomSummaryList(rooms.group),
            channel: await this.decryptRoomSummaryList(rooms.channel),
            bot: await this.decryptRoomSummaryList(rooms.bot),
        };
    }

    private async decryptRoomSummaryList(rooms: RoomSummary[]): Promise<RoomSummary[]> {
        return Promise.all(rooms.map(async (room) => {
            if (room.status === 'deleted') {
                return {
                    ...room,
                    display_name: 'Deleted Contact',
                    avatar_url: undefined,
                    unread_count: 0,
                };
            }
            if (!room.latest_message) {
                return room;
            }

            if (room.latest_message_sender_id === undefined || room.latest_message_sender_id === null) {
                return { ...room, latest_message: LATEST_MESSAGE_FALLBACK };
            }

            try {
                const decrypted = await e2eeService.decryptMessage(
                    room.latest_message,
                    room.latest_message_sender_id,
                    room.room_id,
                );
                return {
                    ...room,
                    latest_message: decrypted === WAITING_FOR_SENDER_KEY
                        ? getWaitingForSenderKeyPreview(room.room_type, LATEST_MESSAGE_FALLBACK)
                        : decrypted,
                };
            } catch (err) {
                logger.warn(`Failed to decrypt latest message for room ${room.room_id}`, err);
                return { ...room, latest_message: LATEST_MESSAGE_FALLBACK };
            }
        }));
    }

    private async fetchRoomDetail(roomId: number): Promise<RoomDetail> {
        const existing = this._roomDetailFetchPromises.get(roomId);
        if (existing) {
            return existing;
        }

        const promise = chatApi.getRoomDetail(roomId);
        this._roomDetailFetchPromises.set(roomId, promise);

        try {
            return await promise;
        } catch (err) {
            logger.error(`Failed to load room detail for ${roomId}`, err);
            throw err;
        } finally {
            if (this._roomDetailFetchPromises.get(roomId) === promise) {
                this._roomDetailFetchPromises.delete(roomId);
            }
        }
    }

    private async decryptRoomMessages(roomId: number, messages: Message[]): Promise<Message[]> {
        return Promise.all(messages.map(async (message) => ({
            ...message,
            content: await e2eeService.decryptMessage(message.content, message.sender_id, roomId).catch(() => message.content),
        })));
    }

    async loadRoomDetail(roomId: number, options?: LoadRoomDetailOptions): Promise<RoomDetail> {
        const store = useChatStore.getState();
        const detail = await this.fetchRoomDetail(roomId);

        if (options?.persist !== false) {
            store.setRoomDetail(detail);
        }
        if (options?.hydrateMessages) {
            store.setLoadingMessages(true);
            try {
                const decryptedMessages = await this.decryptRoomMessages(roomId, detail.messages);
                store.setMessages(roomId, decryptedMessages, detail.messages.length === 20);
            } finally {
                store.setLoadingMessages(false);
            }
        }

        return detail;
    }

    async loadMessages(roomId: number, beforeId?: number): Promise<void> {
        const store = useChatStore.getState();
        store.setLoadingMessages(true);
        try {
            const { messages, has_more } = await chatApi.getMessages(roomId, beforeId);
            const decrypted = await this.decryptRoomMessages(roomId, messages);
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
        if (this.isRoomDeleted(roomId)) {
            throw new Error('This chat is no longer available.');
        }
        if (this.isDirectRoomBlocked(roomId)) {
            throw this.blockedDirectRoomError(roomId);
        }

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
        if (this.isRoomDeleted(roomId)) return;

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

    async prepareDirectRoom(roomId: number): Promise<void> {
        const existing = this._directRoomOpenPromises.get(roomId);
        if (existing) {
            await existing;
            return;
        }

        const promise = this.prepareDirectRoomOnce(roomId);
        this._directRoomOpenPromises.set(roomId, promise);
        try {
            await promise;
        } finally {
            if (this._directRoomOpenPromises.get(roomId) === promise) {
                this._directRoomOpenPromises.delete(roomId);
            }
        }
    }

    private async prepareDirectRoomOnce(roomId: number): Promise<void> {
        const chatStore = useChatStore.getState();
        if (this.isRoomDeleted(roomId)) {
            chatStore.setPendingInvitation(null);
            chatStore.setDirectKeyStatus(roomId, 'locked');
            return;
        }
        if (this.isDirectRoomBlocked(roomId)) {
            chatStore.setPendingInvitation(null);
            chatStore.setDirectKeyStatus(roomId, 'locked');
            return;
        }

        chatStore.setDirectKeyStatus(roomId, 'loading');
        const invitation = await this.loadMyRoomInvitation(roomId);
        if (invitation?.found && invitation.role === 'invitee') {
            return;
        }

        await this.initializeDirectRoomEncryption(roomId);
    }

    // [EN] initializeDirectRoomEncryption: ensures both local and backend sender-key state exist,
    //      then creates sender key requests for members whose keys are still missing locally.
    // [中] initializeDirectRoomEncryption：確認本地與後端 sender key 狀態都存在，
    //      並為本地仍缺少 sender key 的成員建立請求。
    async initializeDirectRoomEncryption(
        roomId: number,
        options?: { roomDetail?: RoomDetail; currentMemberId?: number },
    ): Promise<void> {
        const existing = this._directRoomInitPromises.get(roomId);
        if (existing) {
            await existing;
            return;
        }

        const promise = this.initializeDirectRoomEncryptionOnce(roomId, options);
        this._directRoomInitPromises.set(roomId, promise);
        try {
            await promise;
        } finally {
            if (this._directRoomInitPromises.get(roomId) === promise) {
                this._directRoomInitPromises.delete(roomId);
            }
        }
    }

    private async initializeDirectRoomEncryptionOnce(
        roomId: number,
        options?: { roomDetail?: RoomDetail; currentMemberId?: number },
    ): Promise<void> {
        if (this.isRoomDeleted(roomId) || options?.roomDetail?.status === 'deleted') {
            useChatStore.getState().setDirectKeyStatus(roomId, 'locked');
            return;
        }
        if (this.isDirectRoomBlocked(roomId, options?.roomDetail)) {
            useChatStore.getState().setDirectKeyStatus(roomId, 'locked');
            return;
        }

        if (useE2eeStore.getState().bootstrapStatus !== 'ready') {
            logger.warn(`Skipping direct room E2EE initialization for room ${roomId}: bootstrap not ready`, {
                bootstrapStatus: useE2eeStore.getState().bootstrapStatus,
            });
            return;
        }

        const accountId = useUserStore.getState().currentUser?.accountId;
        if (!accountId) return;

        const chatStore = useChatStore.getState();
        chatStore.setDirectKeyStatus(roomId, 'loading');

        try {
            const detail = await this.ensureRoomDetail(
                roomId,
                options?.roomDetail,
                options?.roomDetail === undefined,
            );
            const reconciliation = await e2eeService.reconcileRoomSenderKeys({
                roomId,
                roomMembers: detail.members,
                currentMemberId: options?.currentMemberId,
            });
            const unlocked = e2eeService.isDirectRoomReadyFromState(reconciliation.status, reconciliation.localStates, {
                roomMembers: detail.members,
                currentMemberId: reconciliation.currentMemberId,
            });
            chatStore.setDirectKeyStatus(roomId, unlocked ? 'unlocked' : 'locked');
            logger.info(`Direct room E2EE initialized for room ${roomId}`);
        } catch (err) {
            chatStore.setDirectKeyStatus(roomId, 'locked');
            throw err;
        }
    }

    // [EN] initializeGroupRoomEncryption: uploads own sender key to all room members if missing,
    //      checks for missing sender keys in the room, sends requests for any pending members,
    //      and fetches available keys into local storage.
    // [中] initializeGroupRoomEncryption：若自身 sender key 尚未上傳則對所有房間成員提供，
    //      檢查房間內缺少的 sender key，對待處理成員建立請求，並將已有的 sender key 存入本地。
    async initializeGroupRoomEncryption(
        roomId: number,
        options?: { roomDetail?: RoomDetail; currentMemberId?: number },
    ): Promise<void> {
        if (this.isRoomDeleted(roomId) || options?.roomDetail?.status === 'deleted') {
            return;
        }

        if (useE2eeStore.getState().bootstrapStatus !== 'ready') {
            logger.warn(`Skipping group room E2EE initialization for room ${roomId}: bootstrap not ready`, {
                bootstrapStatus: useE2eeStore.getState().bootstrapStatus,
            });
            return;
        }

        const accountId = useUserStore.getState().currentUser?.accountId;
        if (!accountId) return;

        const detail = await this.ensureRoomDetail(
            roomId,
            options?.roomDetail,
            options?.roomDetail === undefined,
        );
        await e2eeService.reconcileRoomSenderKeys({
            roomId,
            roomMembers: detail.members,
            currentMemberId: options?.currentMemberId,
        });
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
                    const detail = await this.ensureRoomDetail(ctx.roomId);
                    await this.initializeDirectRoomEncryption(ctx.roomId, {
                        roomDetail: detail,
                        currentMemberId: response.member_id,
                    });
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

    markRoomDeleted(roomId: number): void {
        useChatStore.getState().markRoomDeleted(roomId);
    }
}

export const chatRoomService = new ChatRoomService();
