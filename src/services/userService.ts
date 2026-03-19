import { authApi, userApi } from "@/api/index.ts";
import { useUserStore } from "@/stores/userStore.ts";
import {
    AuthMessageResponse,
    CurrentUserResponse, UpdateProfileRequest,
    UserRegisterRequest,
} from "@/types/user.ts";
import { toast } from "sonner";
import { useDeviceStore } from "@/stores/deviceStore.ts";

class UserService {
    async login(email: string, password: string): Promise<AuthMessageResponse> {
        const deviceState = useDeviceStore.getState();
        const response = await authApi.login({
            identifier: email,
            password,
            device_id: deviceState.deviceId ?? '',
        });

        const currentUser = await this.fetchCurrentUser();
        this.setAuthenticatedUser(currentUser);

        return response;
    }

    async register(payload: UserRegisterRequest): Promise<AuthMessageResponse> {
        return authApi.register({
            account: payload.account ?? payload.email,
            email: payload.email,
            name: payload.name,
            password: payload.password,
        });
    }

    async logout(): Promise<void> {
        await authApi.logout();

        const state = useUserStore.getState();
        state.setCurrentUser({
            id: 0,
            name: undefined,
            token: undefined,
            email: undefined,
            isLoggedIn: false,
        });
    }

    async updateUser(payload: Partial<UpdateProfileRequest>): Promise<void> {
        if (!payload.name) {
            return;
        }

        await userApi.updateProfile({ name: payload.name });
        const currentUser = await this.fetchCurrentUser();
        this.setAuthenticatedUser(currentUser);
    }

    async uploadAvatar(file: File): Promise<{ avatarUrl: string }> {
        if (file.size > 5 * 1024 * 1024) {
            toast.error('File size exceeds 5MB');
        }

        const formData = new FormData();
        formData.append('avatar', file);

        const response = await userApi.uploadAvatar(formData);

        return { avatarUrl: response.avatar_url };
    }

    async fetchCurrentUser(): Promise<CurrentUserResponse> {
        const response = await authApi.getProfile();

        return {
            id: response.current_user.id,
            name: response.current_user.name,
            email: response.email,
            avatar_url: response.current_user.avatar,
            roles: response.current_user.role_codes ?? [],
        };
    }

    private setAuthenticatedUser(user: CurrentUserResponse): void {
        const state = useUserStore.getState();
        state.setCurrentUser({
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar_url,
            isLoggedIn: true,
            roles: user.roles,
        });
    }
}

export const userService = new UserService();
