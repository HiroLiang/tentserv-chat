export interface User {
    id: number;
    accountId?: number;
    name?: string;
    email?: string;
    avatar?: string;
    token?: string;
    isLoggedIn?: boolean;
    roles?: string[]; // 'user' | 'admin' | 'vendor' | 'guest'
}

export interface UserRegisterRequest {
    account?: string;
    email: string;
    name: string;
    password: string;
    confirmPassword: string;
}

export interface AuthMessageResponse {
    message?: string;
}

export interface PendingVerificationState {
    kind: 'register' | 'device_login';
    verificationToken: string;
    verificationExpiresAtMs: number;
}

export interface LoginFlowResponse {
    loginStatus: 'authenticated' | 'device_verification_required';
    verificationToken?: string;
    verificationExpiresAtMs?: number;
}

export interface CurrentUserResponse {
    id: number;
    accountId: number;
    name: string;
    email: string;
    avatar_url?: string;
    create_at?: string;
    roles: string[];
}

export interface UpdateProfileRequest {
    name: string;
}
