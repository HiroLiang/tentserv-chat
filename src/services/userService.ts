import { http } from "@/api/http.ts";
import { useUserStore } from "@/stores/userStore.ts";
import {
    AuthMessageResponse,
    CurrentUserResponse, UpdateProfileRequest,
    UserLoginRequest,
    UserRegisterRequest,
} from "@/types/user.ts";
import { toast } from "sonner";

class UserService {
    async login(email: string, password: string): Promise<AuthMessageResponse> {
        const request: UserLoginRequest = { email, password };
        const response = await http.post<AuthMessageResponse>("/api/user/login", request);

        const currentUser = await this.fetchCurrentUser();
        this.setAuthenticatedUser(currentUser);

        return response.data;
    }

    async register(payload: UserRegisterRequest): Promise<AuthMessageResponse> {
        const response = await http.post<AuthMessageResponse>("/api/user/register", payload);
        return response.data;
    }

    async logout(): Promise<void> {
        await http.post("/api/user/logout");

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
        await http.patch("/api/user/profile", payload);
        const currentUser = await this.fetchCurrentUser();
        this.setAuthenticatedUser(currentUser);
    }

    async uploadAvatar(file: File): Promise<{ avatarUrl: string }> {
        if (file.size > 5 * 1024 * 1024) {
            toast.error('File size exceeds 5MB');
        }

        const formData = new FormData();
        formData.append('avatar', file);

        const response = await http.post<{ avatar_url: string }>('/api/user/avatar', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });

        return { avatarUrl: response.data.avatar_url };
    }

    async fetchCurrentUser(): Promise<CurrentUserResponse> {
        const response = await http.get<CurrentUserResponse>("/api/user/me");
        return response.data;
    }

    private setAuthenticatedUser(user: CurrentUserResponse): void {
        const state = useUserStore.getState();
        state.setCurrentUser({
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar_url,
            isLoggedIn: true,
        });
    }
}

export const userService = new UserService();
