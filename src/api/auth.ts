import { get, post } from "@/api/http.ts";
import type {
    AuthLoginRequest,
    AuthLoginResponse,
    AuthLogoutResponse,
    AuthProfileResponse,
    AuthResendVerifyEmailRequest,
    AuthResendVerifyEmailResponse,
    AuthRegisterRequest,
    AuthRegisterResponse,
    AuthVerifyEmailRequest,
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

    verifyEmail: (payload: AuthVerifyEmailRequest) =>
        post<AuthVerifyEmailResponse, AuthVerifyEmailRequest>('/api/auth/verify-email', payload),

    resendVerifyEmail: (payload: AuthResendVerifyEmailRequest) =>
        post<AuthResendVerifyEmailResponse, AuthResendVerifyEmailRequest>('/api/auth/resend-verify-email', payload),
};
