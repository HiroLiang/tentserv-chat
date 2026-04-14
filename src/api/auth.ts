import { get, post } from "@/api/http.ts";
import type {
    AuthLoginRequest,
    AuthLoginResponse,
    AuthLogoutResponse,
    AuthProfileResponse,
    AuthResendLoginDeviceVerificationRequest,
    AuthResendLoginDeviceVerificationResponse,
    AuthResendVerifyEmailRequest,
    AuthResendVerifyEmailResponse,
    AuthRegisterRequest,
    AuthRegisterResponse,
    AuthVerifyEmailRequest,
    AuthVerifyEmailResponse,
    AuthVerifyLoginDeviceRequest,
    AuthVerifyLoginDeviceResponse,
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

    verifyLoginDevice: (payload: AuthVerifyLoginDeviceRequest) =>
        post<AuthVerifyLoginDeviceResponse, AuthVerifyLoginDeviceRequest>('/api/auth/verify-login-device', payload),

    resendVerifyEmail: (payload: AuthResendVerifyEmailRequest) =>
        post<AuthResendVerifyEmailResponse, AuthResendVerifyEmailRequest>('/api/auth/resend-verify-email', payload),

    resendLoginDeviceVerification: (payload: AuthResendLoginDeviceVerificationRequest) =>
        post<AuthResendLoginDeviceVerificationResponse, AuthResendLoginDeviceVerificationRequest>(
            '/api/auth/resend-login-device-verification',
            payload,
        ),
};
