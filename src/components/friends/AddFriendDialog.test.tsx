import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { friendService } from "@/services/friendService.ts";
import { AddFriendDialog } from "./AddFriendDialog.tsx";

vi.mock("@/config/env.ts", () => ({
    env: {
        API_BASE_URL: "http://api.test",
        WS_BASE_URL: "ws://ws.test",
        IS_DEV: false,
    },
}));

vi.mock("@/services/friendService.ts", () => ({
    friendService: {
        searchUsersByName: vi.fn(),
        applyFriend: vi.fn(),
        blockUser: vi.fn(),
    },
}));

describe("AddFriendDialog", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.mocked(friendService.searchUsersByName).mockResolvedValue([]);
        vi.mocked(friendService.applyFriend).mockResolvedValue(undefined);
        vi.mocked(friendService.blockUser).mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("debounces name search by 600ms", async () => {
        render(<AddFriendDialog onClose={vi.fn()} />);

        fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
            target: { value: "mina" },
        });

        expect(friendService.searchUsersByName).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(599);
        });
        expect(friendService.searchUsersByName).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(friendService.searchUsersByName).toHaveBeenCalledWith("mina");
    });

    it("ignores stale search results and renders public ids with status labels", async () => {
        let resolveFirst: ((value: any[]) => void) | undefined;
        vi.mocked(friendService.searchUsersByName)
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveFirst = resolve;
            }))
            .mockResolvedValueOnce([
                { user_id: 601, name: "Mina", avatar: "mina.png", account: "mina", public_id: "mina-public", friendship_status: "accepted" },
                { user_id: 602, name: "Nina", avatar: "nina.png", account: "nina", public_id: "nina-public", friendship_status: "pending" },
                { user_id: 603, name: "Rina", avatar: "rina.png", account: "rina", public_id: "rina-public", friendship_status: "blocked" },
            ]);

        render(<AddFriendDialog onClose={vi.fn()} />);

        fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
            target: { value: "m" },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
            await Promise.resolve();
        });
        fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
            target: { value: "ni" },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
            await Promise.resolve();
        });
        await act(async () => {
            resolveFirst?.([
                { user_id: 999, name: "Old Result", avatar: "", account: "old", public_id: "old-public" },
            ]);
            await Promise.resolve();
        });

        expect(screen.getByText("mina-public")).toBeInTheDocument();
        expect(screen.queryByText("Old Result")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Friend" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Applying" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Blocked" })).toBeDisabled();
    });

    it("marks a user as applying after a successful apply", async () => {
        vi.mocked(friendService.searchUsersByName).mockResolvedValue([
            { user_id: 601, name: "Mina", avatar: "mina.png", account: "mina", public_id: "mina-public" },
        ]);

        render(<AddFriendDialog onClose={vi.fn()} />);

        fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
            target: { value: "mina" },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
            await Promise.resolve();
        });
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Apply" }));
            await Promise.resolve();
        });

        expect(friendService.applyFriend).toHaveBeenCalledWith(601);
        expect(screen.getByRole("button", { name: "Applying" })).toBeDisabled();
    });

    it("marks a user as blocked after a successful block", async () => {
        vi.mocked(friendService.searchUsersByName).mockResolvedValue([
            { user_id: 601, name: "Mina", avatar: "mina.png", account: "mina", public_id: "mina-public" },
        ]);

        render(<AddFriendDialog onClose={vi.fn()} />);

        fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
            target: { value: "mina" },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
            await Promise.resolve();
        });
        fireEvent.click(screen.getByRole("button", { name: "Block" }));

        expect(screen.getByRole("alertdialog")).toHaveTextContent("Block Mina?");
        expect(friendService.blockUser).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Block" }));
            await Promise.resolve();
        });

        expect(friendService.blockUser).toHaveBeenCalledWith(601);
        expect(screen.getByRole("button", { name: "Blocked" })).toBeDisabled();
    });

    it("does not block a search result when the confirmation dialog is cancelled", async () => {
        vi.mocked(friendService.searchUsersByName).mockResolvedValue([
            { user_id: 601, name: "Mina", avatar: "mina.png", account: "mina", public_id: "mina-public" },
        ]);

        render(<AddFriendDialog onClose={vi.fn()} />);

        fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
            target: { value: "mina" },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
            await Promise.resolve();
        });

        fireEvent.click(screen.getByRole("button", { name: "Block" }));
        expect(screen.getByRole("alertdialog")).toHaveTextContent("They will not be able to find you or send you messages.");
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

        expect(friendService.blockUser).not.toHaveBeenCalled();
    });

    it("clears local state and calls onClose when closing the dialog", async () => {
        const onClose = vi.fn();
        vi.mocked(friendService.searchUsersByName).mockResolvedValue([
            { user_id: 601, name: "Mina", avatar: "mina.png", account: "mina", public_id: "mina-public" },
        ]);

        render(<AddFriendDialog onClose={onClose} />);

        fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
            target: { value: "mina" },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
            await Promise.resolve();
        });
        expect(screen.getByText("mina-public")).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Close" }));
            await Promise.resolve();
        });

        expect(screen.getByPlaceholderText(/search by name/i)).toHaveValue("");
        expect(screen.queryByText("mina-public")).not.toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
