import { saveAuthToken, getAuthToken, clearAuthToken } from "@/bridge/auth.ts";
import { authApi, userApi } from "@/api/index.ts";
import type {
    AuthLoginResponse,
    AuthProfileResponse,
    AuthRegisterResponse,
    AuthResendLoginDeviceVerificationResponse,
    AuthResendVerifyEmailResponse,
    AuthVerifyEmailRequest,
    AuthVerifyEmailResponse,
    AuthVerifyLoginDeviceRequest,
    AuthVerifyLoginDeviceResponse,
} from "@/api/types.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import {
    CurrentUserResponse, UpdateProfileRequest,
    LoginFlowResponse,
    UserRegisterRequest,
} from "@/types/user.ts";
import { toast } from "sonner";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { useE2eeStore } from "@/stores/e2eeStore.ts";
import { chatService } from "@/services/chatService.ts";

const toCurrentUserResponse = (response: AuthProfileResponse): CurrentUserResponse => ({
    id: response.current_user.id,
    accountId: response.account_id,
    name: response.current_user.name,
    email: response.email,
    avatar_url: response.current_user.avatar,
    roles: response.current_user.role_codes ?? [],
});

const setAuthenticatedUserState = (user: CurrentUserResponse, token?: string): void => {
    const state = useUserStore.getState();
    const preservedToken = token ?? state.currentUser?.token;
    state.setCurrentUser({
        id: user.id,
        accountId: user.accountId,
        email: user.email,
        name: user.name,
        avatar: user.avatar_url,
        token: preservedToken,
        isLoggedIn: true,
        roles: user.roles,
    });
};

const fetchCurrentUserProfile = async (): Promise<CurrentUserResponse> => {
    const response = await authApi.getProfile();
    return toCurrentUserResponse(response);
};

const hydrateAuthenticatedSessionState = async (): Promise<CurrentUserResponse> => {
    const token = useUserStore.getState().currentUser?.token;
    const currentUser = await fetchCurrentUserProfile();
    setAuthenticatedUserState(currentUser, token);

    if (token && currentUser.accountId) {
        await saveAuthToken(currentUser.accountId, token);
    }

    return currentUser;
};

// [EN] UserService handles authentication lifecycle: login, register, session restore, logout, and profile updates.
//      Token is persisted in the OS keyring via the Tauri bridge.
// [中] UserService 負責認證生命週期：登入、註冊、會話還原、登出及個人資料更新，Token 透過 Tauri bridge 存入系統 keyring。
// [日] UserService は認証ライフサイクルを担当：ログイン、登録、セッション復元、ログアウト、プロフィール更新。
//      トークンは Tauri ブリッジ経由で OS keyring に保存される。
class UserService {
    // [EN] Login: call API with device_id, fetch current user, save token to keyring.
    // [中] 登入：攜帶 device_id 呼叫 API，取得目前使用者資料，將 token 存入 keyring。
    // [日] ログイン：device_id を含めて API を呼び出し、現在のユーザー情報を取得し、トークンを keyring に保存する。
    async login(identifier: string, password: string): Promise<LoginFlowResponse> {
        useE2eeStore.getState().resetBootstrapState();
        const deviceState = useDeviceStore.getState();
        const response = await authApi.login({
            identifier,
            password,
            device_id: deviceState.deviceId ?? '',
        });

        if (response.login_status !== 'authenticated') {
            return this.toLoginFlowResponse(response);
        }

        await hydrateAuthenticatedSessionState();
        return this.toLoginFlowResponse(response);
    }

    // [EN] Restore session: read token from keyring, call /api/auth/profile to populate userStore.
    //      On failure, clear the token and return false so AppInitializer can redirect to /login.
    // [中] 還原會話：從 keyring 讀取 token，呼叫 /api/auth/profile 填入 userStore；失敗時清除 token 並返回 false。
    // [日] セッション復元：keyring からトークンを読み取り、/api/auth/profile を呼び出して userStore に反映する。
    //      失敗時はトークンをクリアして false を返し、AppInitializer が /login にリダイレクトできるようにする。
    async tryRestoreSession(): Promise<boolean> {
        const token = await getAuthToken();
        if (!token) {
            useE2eeStore.getState().resetBootstrapState();
            return false;
        }

        // Set a token in store so the HTTP interceptor can attach it to getProfile()
        useUserStore.getState().setCurrentUser({ id: 0, token });

        try {
            const profile = await authApi.getProfile();
            useUserStore.getState().setCurrentUser({
                id: profile.current_user.id,
                accountId: profile.account_id,
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
            useE2eeStore.getState().resetBootstrapState();
            useUserStore.getState().setCurrentUser({ id: 0, token: undefined, isLoggedIn: false });
            return false;
        }
    }

    async register(payload: UserRegisterRequest): Promise<AuthRegisterResponse> {
        return authApi.register({
            account: payload.account!,
            email: payload.email,
            name: payload.name,
            password: payload.password,
            confirm_password: payload.confirmPassword,
        });
    }

    async verifyEmail(payload: AuthVerifyEmailRequest): Promise<AuthVerifyEmailResponse> {
        return authApi.verifyEmail(payload);
    }

    async verifyLoginDevice(payload: AuthVerifyLoginDeviceRequest): Promise<AuthVerifyLoginDeviceResponse> {
        return authApi.verifyLoginDevice(payload);
    }

    async hydrateAuthenticatedSession(): Promise<CurrentUserResponse> {
        return hydrateAuthenticatedSessionState();
    }

    async resendVerifyEmail(token: string): Promise<AuthResendVerifyEmailResponse> {
        return authApi.resendVerifyEmail({ token });
    }

    async resendLoginDeviceVerification(token: string): Promise<AuthResendLoginDeviceVerificationResponse> {
        return authApi.resendLoginDeviceVerification({ token });
    }

    // [EN] Logout: call API, stop the Rust chat runtime, clear keyring token, reset chat and user stores.
    // [中] 登出：呼叫 API、停止 Rust chat runtime、清除 keyring token，重置聊天與使用者狀態。
    // [日] ログアウト：API 呼び出し、Rust chat runtime を停止し、keyring トークン削除、チャット・ユーザーストアをリセットする。
    async logout(): Promise<void> {
        const accountId = useUserStore.getState().currentUser?.accountId;
        await authApi.logout();
        await chatService.stop();

        if (accountId) await clearAuthToken(accountId);

        useChatStore.getState().resetChat();
        useE2eeStore.getState().resetBootstrapState();

        const state = useUserStore.getState();
        state.setParticipantId(null);
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
        const currentUser = await fetchCurrentUserProfile();
        setAuthenticatedUserState(currentUser);
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
        return fetchCurrentUserProfile();
    }

    private toLoginFlowResponse(response: AuthLoginResponse): LoginFlowResponse {
        return {
            loginStatus: response.login_status,
            verificationToken: response.verification_token,
            verificationExpiresAtMs: response.verification_expires_at_ms,
        };
    }
}

export const userService = new UserService();
