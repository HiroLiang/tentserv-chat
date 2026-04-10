import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Navbar } from "./Navbar.tsx";
import { userService } from "@/services/userService.ts";
import { useE2eeStore } from "@/stores/e2eeStore.ts";
import { useUserStore } from "@/stores/userStore.ts";

const envMock = vi.hoisted(() => ({
    API_BASE_URL: "http://api.test",
}));

vi.mock("@/config/env.ts", () => ({
    env: envMock,
}));

vi.mock("@/services/userService.ts", () => ({
    userService: {
        logout: vi.fn(),
    },
}));

vi.mock("sonner", () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

const resetStores = () => {
    useUserStore.setState({
        currentUser: {
            id: 501,
            accountId: 42,
            name: "Hiro",
            email: "hiro@example.com",
            avatar: "avatars/hiro.png",
            isLoggedIn: true,
            roles: ["user"],
        },
        recordedUsers: new Map(),
        participantId: null,
    });
    useE2eeStore.setState({
        keysUploaded: true,
        otpKeyCount: 0,
        otpKeyTargetCount: 0,
        otpReplenishThreshold: 0,
        bootstrapStatus: "ready",
        bootstrapError: null,
        senderKeyRequests: new Set(),
    });
};

const renderNavbar = () =>
    render(
        <MemoryRouter initialEntries={["/"]}>
            <Navbar />
            <Routes>
                <Route path="/" element={<div>Home Route</div>} />
                <Route path="/login" element={<div>Login Route</div>} />
            </Routes>
        </MemoryRouter>,
    );

describe("Navbar user menu", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStores();
        vi.mocked(userService.logout).mockResolvedValue(undefined);
    });

    it("shows Settings as disabled and redirects to login after logout", async () => {
        const user = userEvent.setup();
        renderNavbar();

        await user.click(screen.getByLabelText("Open user menu"));

        const settingsItem = await screen.findByRole("menuitem", { name: "Settings" });
        expect(settingsItem).toHaveAttribute("data-disabled");
        expect(settingsItem).toHaveAttribute("aria-disabled", "true");

        await user.click(screen.getByRole("menuitem", { name: "Logout" }));

        await waitFor(() => expect(userService.logout).toHaveBeenCalledTimes(1));
        expect(await screen.findByText("Login Route")).toBeInTheDocument();
    });
});
