import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { RegisterVerifiedPage } from "./RegisterVerifiedPage.tsx";

vi.mock("@/components/layout/Navbar.tsx", () => ({
    Navbar: () => <div data-testid="navbar" />,
}));

describe("RegisterVerifiedPage", () => {
    it("routes to login from the success screen", async () => {
        const user = userEvent.setup();

        render(
            <MemoryRouter initialEntries={["/register/verified"]}>
                <Routes>
                    <Route path="/register/verified" element={<RegisterVerifiedPage />} />
                    <Route path="/login" element={<div>Login Route</div>} />
                </Routes>
            </MemoryRouter>,
        );

        expect(screen.getByText("Email verified")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Go to Login" }));
        expect(await screen.findByText("Login Route")).toBeInTheDocument();
    });
});
