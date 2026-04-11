import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfilePage } from "./ProfilePage.tsx";
import { userService } from "@/services/userService.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { toast } from "sonner";

vi.mock("@/components/layout/Navbar.tsx", () => ({
    Navbar: () => <div data-testid="navbar" />,
}));

vi.mock("@/config/env.ts", () => ({
    env: {
        API_BASE_URL: "http://api.test",
    },
}));

vi.mock("react-cropper", () => ({
    default: () => <div data-testid="cropper" />,
}));

vi.mock("@/services/userService.ts", () => ({
    userService: {
        updateUser: vi.fn(),
        uploadAvatar: vi.fn(),
    },
}));

vi.mock("@/utils/logger.ts", () => ({
    logger: {
        error: vi.fn(),
    },
}));

vi.mock("sonner", () => ({
    toast: {
        loading: vi.fn(() => "toast-1"),
        success: vi.fn(),
        error: vi.fn(),
        dismiss: vi.fn(),
    },
}));

describe("ProfilePage saving state", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useUserStore.setState({
            currentUser: {
                id: 1,
                name: "Hiro",
                avatar: "avatars/hiro.png",
                accountId: 77,
            },
            recordedUsers: new Map(),
            participantId: null,
        });
        vi.mocked(userService.uploadAvatar).mockResolvedValue({ avatarUrl: "avatars/new.png" });
    });

    it("prevents duplicate submits and shows Saving while the request is in flight", async () => {
        const user = userEvent.setup();
        let resolveUpdate: (() => void) | undefined;
        vi.mocked(userService.updateUser).mockReturnValue(new Promise<void>((resolve) => {
            resolveUpdate = resolve;
        }));

        render(<ProfilePage />);

        const input = screen.getByLabelText("Name");
        await user.clear(input);
        await user.type(input, "Hiro Liang");

        const saveButton = screen.getByRole("button", { name: "Save Changes" });
        await user.click(saveButton);

        await waitFor(() => expect(userService.updateUser).toHaveBeenCalledWith({ name: "Hiro Liang" }));
        expect(userService.updateUser).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
        expect(screen.getByLabelText("Name")).toBeDisabled();
        expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
        expect(toast.loading).toHaveBeenCalledWith("Saving...");

        await user.click(screen.getByRole("button", { name: "Saving..." }));
        expect(userService.updateUser).toHaveBeenCalledTimes(1);

        resolveUpdate?.();

        await waitFor(() => expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled());
        expect(toast.dismiss).toHaveBeenCalledWith("toast-1");
        expect(toast.success).toHaveBeenCalledWith("Profile updated successfully");
    });
});
