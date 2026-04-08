import { beforeEach, describe, expect, it, vi } from "vitest";
import { authApi } from "@/api/index.ts";
import { clearAuthToken, getAuthToken, saveAuthToken } from "@/bridge/auth.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { userService } from "./userService.ts";

vi.mock("@/api/index.ts", () => ({
    authApi: {
        login: vi.fn(),
        logout: vi.fn(),
        getProfile: vi.fn(),
        register: vi.fn(),
    },
    userApi: {
        updateProfile: vi.fn(),
        uploadAvatar: vi.fn(),
    },
}));

vi.mock("@/bridge/auth.ts", () => ({
    saveAuthToken: vi.fn(),
    getAuthToken: vi.fn(),
    clearAuthToken: vi.fn(),
}));

vi.mock("./wsService.ts", () => ({
    wsService: {
        disconnect: vi.fn(),
    },
}));

vi.mock("sonner", () => ({
    toast: {
        error: vi.fn(),
    },
}));

const profileResponse = {
    account_id: 42,
    email: "hiro@example.com",
    current_user: {
        id: 501,
        name: "Hiro",
        avatar: "avatar.png",
        role_codes: ["user"],
    },
};

const resetStores = () => {
    useUserStore.setState({
        currentUser: { id: 0 },
        recordedUsers: new Map(),
        participantId: null,
    });
    useDeviceStore.setState({
        deviceId: null,
        deviceName: null,
        platform: null,
        registered: false,
        createdAt: null,
        updatedAt: null,
    });
};

describe("userService login/session", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStores();
        vi.mocked(saveAuthToken).mockResolvedValue(undefined);
        vi.mocked(getAuthToken).mockResolvedValue(null);
        vi.mocked(clearAuthToken).mockResolvedValue(undefined);
        vi.mocked(authApi.getProfile).mockResolvedValue(profileResponse);
    });

    it("logs in with identifier, saves the interceptor token, and populates the user store", async () => {
        useDeviceStore.setState({
            deviceId: "device-1",
            deviceName: "MacBook",
            platform: "macos",
            registered: true,
            createdAt: 1000,
        });
        vi.mocked(authApi.login).mockImplementation(async () => {
            useUserStore.getState().setCurrentUser({ id: 0, token: "token-login" });
            return { message: "Login successfully" };
        });

        const response = await userService.login("hiro@example.com", "correct-password");

        expect(response).toEqual({ message: "Login successfully" });
        expect(authApi.login).toHaveBeenCalledWith({
            identifier: "hiro@example.com",
            password: "correct-password",
            device_id: "device-1",
        });
        expect(authApi.getProfile).toHaveBeenCalledTimes(1);
        expect(saveAuthToken).toHaveBeenCalledWith(42, "token-login");
        expect(useUserStore.getState().currentUser).toMatchObject({
            id: 501,
            accountId: 42,
            email: "hiro@example.com",
            name: "Hiro",
            avatar: "avatar.png",
            token: "token-login",
            isLoggedIn: true,
            roles: ["user"],
        });
    });

    it("restores a keyring token through the profile endpoint", async () => {
        vi.mocked(getAuthToken).mockResolvedValue("token-restored");

        const restored = await userService.tryRestoreSession();

        expect(restored).toBe(true);
        expect(authApi.getProfile).toHaveBeenCalledTimes(1);
        expect(clearAuthToken).not.toHaveBeenCalled();
        expect(useUserStore.getState().currentUser).toMatchObject({
            id: 501,
            accountId: 42,
            token: "token-restored",
            isLoggedIn: true,
            roles: ["user"],
        });
    });

    it("clears the restored session state when profile restore fails", async () => {
        vi.mocked(getAuthToken).mockResolvedValue("expired-token");
        vi.mocked(authApi.getProfile).mockRejectedValue(new Error("expired"));

        const restored = await userService.tryRestoreSession();

        expect(restored).toBe(false);
        expect(clearAuthToken).toHaveBeenCalledWith();
        expect(useUserStore.getState().currentUser).toMatchObject({
            id: 0,
            isLoggedIn: false,
        });
        expect(useUserStore.getState().currentUser?.token).toBeUndefined();
    });
});
