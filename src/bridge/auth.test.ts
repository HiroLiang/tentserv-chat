import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearAuthToken } from "./auth.ts";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
}));

describe("auth bridge", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(invoke).mockResolvedValue(undefined);
    });

    it("clears the current auth token when no account id is provided", async () => {
        await clearAuthToken();

        expect(invoke).toHaveBeenCalledWith("clear_auth_token");
    });

    it("clears a specific account auth token when account id is provided", async () => {
        await clearAuthToken(42);

        expect(invoke).toHaveBeenCalledWith("clear_auth_token", { accountId: "42" });
    });
});
