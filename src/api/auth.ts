import { get, post } from "@/api/http.ts";
import type {
    AuthLoginRequest,
    AuthLoginResponse,
    AuthLogoutResponse,
    AuthProfileResponse,
    AuthRegisterRequest,
    AuthRegisterResponse,
    AuthVerifyEmailResponse,
} from "@/api/types.ts";

export const authApi = {
    login: (payload: AuthLoginRequest) =>
        post<AuthLoginResponse, AuthLoginRequest>('/api/auth/login', payload),

    logout: () =>
        post<AuthLogoutResponse>('/api/auth/logout'),

    getProfile: () =>
        get<AuthProfileResponse>('/api/auth/profile'),

    register: (payload: AuthRegisterRequest) =>
        post<AuthRegisterResponse, AuthRegisterRequest>('/api/auth/register', payload),

    verifyEmail: (token: string) =>
        get<AuthVerifyEmailResponse>('/api/auth/verify-email', {
            params: { token },
        }),
};
