import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
    clearE2eeKeys,
    generateIdentityKeys,
    generateSenderKey,
    hasIdentityKeys,
    performX3dhReceive,
    performX3dhSend,
    replenishOtpKeys,
} from "./e2ee.ts";
import type { PublicKeyBundle } from "@/types/e2ee.ts";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
}));

const emptyBundle: PublicKeyBundle = {
    identity_key_dh: Array(32).fill(1),
    identity_key_sign: Array(32).fill(2),
    signed_pre_key: Array(32).fill(3),
    spk_signature: Array(64).fill(4),
    spk_key_id: 1,
};

describe("e2ee bridge", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(invoke).mockResolvedValue(undefined);
    });

    it("uses accountId for local identity key commands", async () => {
        await hasIdentityKeys(42);
        await generateIdentityKeys(42);
        await replenishOtpKeys(42, 20);

        expect(invoke).toHaveBeenNthCalledWith(1, "has_identity_keys", { accountId: "42" });
        expect(invoke).toHaveBeenNthCalledWith(2, "generate_identity_keys", { accountId: "42" });
        expect(invoke).toHaveBeenNthCalledWith(3, "replenish_otp_keys", { accountId: "42", count: 20 });
    });

    it("uses accountId for local X3DH and sender key commands", async () => {
        await performX3dhSend(42, emptyBundle, [1, 2, 3]);
        await performX3dhReceive(42, {
            identity_key_dh_pub: Array(32).fill(1),
            identity_key_sign_pub: Array(32).fill(2),
            ephemeral_key_pub: Array(32).fill(3),
            spk_key_id: 1,
            ciphertext: [4, 5],
            nonce: Array(12).fill(6),
        }, 1, 7);
        await performX3dhReceive(42, {
            identity_key_dh_pub: Array(32).fill(1),
            identity_key_sign_pub: Array(32).fill(2),
            ephemeral_key_pub: Array(32).fill(3),
            spk_key_id: 1,
            ciphertext: [4, 5],
            nonce: Array(12).fill(6),
        }, 1);
        await generateSenderKey(42, 99);
        await clearE2eeKeys(42);

        expect(invoke).toHaveBeenNthCalledWith(1, "perform_x3dh_send", {
            accountId: "42",
            bundle: emptyBundle,
            plaintext: [1, 2, 3],
        });
        expect(invoke).toHaveBeenNthCalledWith(2, "perform_x3dh_receive", expect.objectContaining({
            accountId: "42",
            spkKeyId: 1,
            otpkKeyId: 7,
        }));
        expect(invoke).toHaveBeenNthCalledWith(3, "perform_x3dh_receive", expect.not.objectContaining({
            otpkKeyId: expect.anything(),
        }));
        expect(invoke).toHaveBeenNthCalledWith(4, "generate_sender_key", {
            accountId: "42",
            memberId: "99",
        });
        expect(invoke).toHaveBeenNthCalledWith(5, "clear_e2ee_keys", { accountId: "42" });
    });
});
