import { get, post, patch } from '@/api/http.ts';
import type {
    CreateRoomRequest,
    CreateRoomResponse,
    GetMessagesResponse,
    SendMessageRequest,
    SendMessageResponse,
    UploadMediaResponse,
    ApproveInvitationRequest,
} from '@/api/types.ts';
import type { GetUserRoomsResponse, RoomDetail } from '@/types/chat.ts';

export const chatApi = {
    getRooms: (): Promise<GetUserRoomsResponse> =>
        get('/api/chat/rooms'),

    createRoom: (req: CreateRoomRequest): Promise<CreateRoomResponse> =>
        post('/api/chat/room', req),

    getRoomDetail: (roomId: number): Promise<RoomDetail> =>
        get(`/api/chat/room/${roomId}`),

    joinRoom: (roomId: number): Promise<void> =>
        post(`/api/chat/room/${roomId}/join`),

    approveInvitation: (invId: number, approve: boolean): Promise<void> =>
        patch(`/api/chat/room/invitations/${invId}`, { approve } as ApproveInvitationRequest),

    getMessages: (roomId: number, beforeId?: number, limit?: number): Promise<GetMessagesResponse> =>
        get(`/api/chat/room/${roomId}/messages`, {
            params: {
                ...(beforeId !== undefined && { before_id: beforeId }),
                ...(limit !== undefined && { limit }),
            },
        }),

    sendMessage: (roomId: number, req: SendMessageRequest): Promise<SendMessageResponse> =>
        post(`/api/chat/room/${roomId}/messages`, req),

    uploadMedia: (roomId: number, file: File): Promise<UploadMediaResponse> => {
        const form = new FormData();
        form.append('file', file);
        return post(`/api/chat/room/${roomId}/media`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },

    markAsRead: (roomId: number): Promise<void> =>
        patch(`/api/chat/room/${roomId}/member/status`),
};
