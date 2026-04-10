import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userService } from "@/services/userService.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { AdminRoute } from "./AdminRoute.tsx";

vi.mock("@/services/userService.ts", () => ({
    userService: {
        fetchCurrentUser: vi.fn(),
    },
}));

const setLoggedInUser = () => {
    useUserStore.setState({
        currentUser: {
            id: 501,
            accountId: 42,
            name: "Hiro",
            email: "hiro@example.com",
            isLoggedIn: true,
            roles: ["user"],
        },
        recordedUsers: new Map(),
        participantId: null,
    });
};

const setLoggedOutUser = () => {
    useUserStore.setState({
        currentUser: { id: 0, isLoggedIn: false },
        recordedUsers: new Map(),
        participantId: null,
    });
};

const renderRoute = () =>
    render(
        <MemoryRouter initialEntries={["/console"]}>
            <Routes>
                <Route path="/" element={<div>Home Route</div>} />
                <Route path="/login" element={<div>Login Route</div>} />
                <Route path="/console" element={<AdminRoute />}>
                    <Route index element={<div>Admin Console</div>} />
                </Route>
            </Routes>
        </MemoryRouter>,
    );

describe("AdminRoute", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setLoggedInUser();
    });

    it("allows admins after a server profile role check", async () => {
        vi.mocked(userService.fetchCurrentUser).mockResolvedValue({
            id: 501,
            accountId: 42,
            name: "Hiro",
            email: "hiro@example.com",
            roles: ["admin"],
        });

        renderRoute();

        expect(await screen.findByText("Admin Console")).toBeInTheDocument();
        expect(userService.fetchCurrentUser).toHaveBeenCalledTimes(1);
    });

    it("redirects signed-in non-admins to home", async () => {
        vi.mocked(userService.fetchCurrentUser).mockResolvedValue({
            id: 501,
            accountId: 42,
            name: "Hiro",
            email: "hiro@example.com",
            roles: ["user"],
        });

        renderRoute();

        expect(await screen.findByText("Home Route")).toBeInTheDocument();
        expect(userService.fetchCurrentUser).toHaveBeenCalledTimes(1);
    });

    it("redirects logged-out users to login without fetching the admin profile", async () => {
        setLoggedOutUser();

        renderRoute();

        expect(await screen.findByText("Login Route")).toBeInTheDocument();
        await waitFor(() => expect(userService.fetchCurrentUser).not.toHaveBeenCalled());
    });
});
