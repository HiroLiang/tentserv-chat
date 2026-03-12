export interface User {
    id: number;
    name?: string;
    email?: string;
    avatar?: string;
    token?: string;
    isLoggedIn?: boolean;
    roles?: string[]; // 'user' | 'admin' | 'vendor' | 'guest'
}

export interface UserLoginRequest {
    email: string;
    password: string;
    device_id?: string;
}

export interface UserRegisterRequest {
    email: string;
    name: string;
    password: string;
}

export interface AuthMessageResponse {
    message?: string;
}

export interface CurrentUserResponse {
    id: number
    name: string;
    email: string;
    avatar_url: string;
    create_at: string;
    roles: string[];
}

export interface UpdateProfileRequest {
    name: string;
}
