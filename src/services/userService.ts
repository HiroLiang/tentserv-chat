import { saveAuthToken, getAuthToken, clearAuthToken } from "@/bridge/auth.ts";
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
    async login(identifier: string, password: string): Promise<AuthMessageResponse> {
        const deviceState = useDeviceStore.getState();
        const response = await authApi.login({
            identifier,
            password,
            device_id: deviceState.deviceId ?? '',
        });

        const currentUser = await this.fetchCurrentUser();
        this.setAuthenticatedUser(currentUser);

        const token = useUserStore.getState().currentUser?.token;
        if (token) await saveAuthToken(token);

        return response;
    }

    async tryRestoreSession(): Promise<boolean> {
        const token = await getAuthToken();
        if (!token) return false;

        // Set a token in store so the HTTP interceptor can attach it to getProfile()
        useUserStore.getState().setCurrentUser({ id: 0, token });

        try {
            const profile = await authApi.getProfile();
            useUserStore.getState().setCurrentUser({
                id: profile.current_user.id,
                name: profile.current_user.name,
                email: profile.email,
                avatar: profile.current_user.avatar,
                token,
                isLoggedIn: true,
                roles: profile.current_user.role_codes ?? [],
            });
            return true;
        } catch {
            await clearAuthToken();
            useUserStore.getState().setCurrentUser({ id: 0, token: undefined, isLoggedIn: false });
            return false;
        }
    }

    async register(payload: UserRegisterRequest): Promise<AuthMessageResponse> {
        return authApi.register({
            account: payload.account!,
            email: payload.email,
            name: payload.name,
            password: payload.password,
        });
    }

    async logout(): Promise<void> {
        await authApi.logout();

        await clearAuthToken();

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
