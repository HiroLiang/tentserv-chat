import type { AxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { http } from "./http.ts";

vi.mock("@/config/env.ts", () => ({
    env: {
        API_BASE_URL: "http://api.test",
        WS_BASE_URL: "ws://ws.test",
        IS_DEV: false,
    },
}));

vi.mock("@/utils/logger.ts", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

const resetStores = () => {
    useUserStore.setState({
        currentUser: { id: 501, token: "token-old", isLoggedIn: true },
        recordedUsers: new Map(),
        participantId: null,
    });
    useDeviceStore.setState({
        deviceId: "device-1",
        deviceName: "MacBook",
        platform: "macos",
        registered: true,
        createdAt: 1000,
        updatedAt: null,
    });
};

const readHeader = (headers: AxiosRequestConfig["headers"], name: string): unknown => {
    if (!headers) return undefined;
    if (typeof headers.get === "function") return headers.get(name);
    return headers[name as keyof typeof headers];
};

describe("http interceptors", () => {
    beforeEach(() => {
        resetStores();
    });

    it("adds Bearer token and X-Device-ID to outgoing requests", async () => {
        let capturedHeaders: AxiosRequestConfig["headers"];

        await http.get("/ping", {
            adapter: async (config) => {
                capturedHeaders = config.headers;
                return {
                    status: 200,
                    statusText: "OK",
                    headers: {},
                    config,
                    data: { ok: true },
                };
            },
        });

        expect(readHeader(capturedHeaders, "Authorization")).toBe("Bearer token-old");
        expect(readHeader(capturedHeaders, "X-Device-ID")).toBe("device-1");
    });

    it("stores a refreshed Authorization token from responses", async () => {
        await http.get("/profile", {
            adapter: async (config) => ({
                status: 200,
                statusText: "OK",
                headers: { authorization: "Bearer token-new" },
                config,
                data: { ok: true },
            }),
        });

        expect(useUserStore.getState().currentUser?.token).toBe("token-new");
    });
});
