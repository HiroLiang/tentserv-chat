import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, post } from "@/api/http.ts";
import { e2eeApi } from "./e2ee.ts";

vi.mock("@/api/http.ts", () => ({
    get: vi.fn(),
    post: vi.fn(),
}));

describe("e2eeApi", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(get).mockResolvedValue({});
        vi.mocked(post).mockResolvedValue({});
    });

    it("requests non-consuming key status with the remote user id and device id", async () => {
        await e2eeApi.checkKeyStatus(501, "device-1");

        expect(get).toHaveBeenCalledWith("/api/e2ee/key-status/501", {
            params: { device_id: "device-1" },
        });
    });

    it("requests the key bootstrap policy", async () => {
        await e2eeApi.getKeyPolicy();

        expect(get).toHaveBeenCalledWith("/api/e2ee/key-policy");
    });

    it("requests key bundle and OTP count with device id query params", async () => {
        await e2eeApi.getKeyBundle(501, "device-1");
        await e2eeApi.countOTPPreKeys("device-1");

        expect(get).toHaveBeenNthCalledWith(1, "/api/e2ee/key-bundle/501", {
            params: { device_id: "device-1" },
        });
        expect(get).toHaveBeenNthCalledWith(2, "/api/e2ee/otp-prekeys/count", {
            params: { device_id: "device-1" },
        });
    });

    it("keeps upload payload wire shapes unchanged", async () => {
        await e2eeApi.uploadIdentityKey("device-1", "identity", "sign");
        await e2eeApi.uploadSignedPreKey("device-1", 1, "spk", "sig");
        await e2eeApi.uploadOTPPreKeys("device-1", [{ key_id: 1, public_key: "otp" }]);

        expect(post).toHaveBeenNthCalledWith(1, "/api/e2ee/identity-key", {
            device_id: "device-1",
            public_key: "identity",
            sign_public_key: "sign",
        });
        expect(post).toHaveBeenNthCalledWith(2, "/api/e2ee/signed-prekey", {
            device_id: "device-1",
            key_id: 1,
            public_key: "spk",
            signature: "sig",
        });
        expect(post).toHaveBeenNthCalledWith(3, "/api/e2ee/otp-prekeys", {
            device_id: "device-1",
            keys: [{ key_id: 1, public_key: "otp" }],
        });
    });
});
