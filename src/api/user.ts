import { get, patch, post } from "@/api/http.ts";
import type {
    UserProfileResponse,
    UserUpdateProfileRequest,
    UserUploadAvatarResponse,
} from "@/api/types.ts";

export const userApi = {
    uploadAvatar: (avatar: FormData) =>
        post<UserUploadAvatarResponse, FormData>('/api/user/avatar', avatar, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        }),

    updateProfile: (payload: UserUpdateProfileRequest) =>
        patch<void, UserUpdateProfileRequest>('/api/user/profile', payload),

    getById: (userId: number) =>
        get<UserProfileResponse>(`/api/user/${userId}`),
};
