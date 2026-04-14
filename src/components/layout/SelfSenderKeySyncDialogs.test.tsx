import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelfSenderKeySyncDialogs } from "./SelfSenderKeySyncDialogs.tsx";
import { useChatStore } from "@/stores/chatStore.ts";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/services/e2eeService.ts", () => ({
    e2eeService: {
        acceptSelfSenderKeySync: vi.fn(),
    },
}));

vi.mock("@/services/userService.ts", () => ({
    userService: {
        logout: vi.fn(),
    },
}));

describe("SelfSenderKeySyncDialogs", () => {
    beforeEach(() => {
        useChatStore.getState().resetChat();
    });

    it("shows the requester blocking copy for the current device while waiting for an older device to sync keys", () => {
        useChatStore.setState({
            syncState: {
                ws_status: "connected",
                pending_business_jobs: 0,
                pending_sync_jobs: 0,
                self_sender_key_sync_status: "pending_provider",
                self_sender_key_sync_error: null,
                self_sender_key_sync: {
                    exists: true,
                    status: "pending_provider",
                    requester_current_device: true,
                    provider_current_device: false,
                    requester_device: {
                        device_id: "device-new",
                        device_name: "Hiro's New Mac",
                        platform: "macos",
                    },
                    provider_device: null,
                    requested_at_ms: Date.now(),
                },
            },
        });

        render(
            <MemoryRouter initialEntries={["/"]}>
                <SelfSenderKeySyncDialogs />
            </MemoryRouter>,
        );

        expect(screen.getByText("Use a trusted device to sync your secure keys")).toBeInTheDocument();
        expect(screen.getByText("Go back to one of your already signed-in devices and approve this key sync request. Until it finishes, this device cannot open older chats or decrypt message history.")).toBeInTheDocument();
        expect(screen.getByText("Waiting for a trusted device")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    });

    it("logs out from the requester blocker dialog", async () => {
        const { userService } = await import("@/services/userService.ts");
        useChatStore.setState({
            syncState: {
                ws_status: "connected",
                pending_business_jobs: 0,
                pending_sync_jobs: 0,
                self_sender_key_sync_status: "pending_provider",
                self_sender_key_sync_error: null,
                self_sender_key_sync: {
                    exists: true,
                    status: "pending_provider",
                    requester_current_device: true,
                    provider_current_device: false,
                    requester_device: {
                        device_id: "device-new",
                        device_name: "Hiro's New Mac",
                        platform: "macos",
                    },
                    provider_device: null,
                    requested_at_ms: Date.now(),
                },
            },
        });

        const user = userEvent.setup();
        render(
            <MemoryRouter initialEntries={["/"]}>
                <SelfSenderKeySyncDialogs />
            </MemoryRouter>,
        );

        await user.click(screen.getByRole("button", { name: "Log out" }));

        expect(userService.logout).toHaveBeenCalledTimes(1);
    });
});
