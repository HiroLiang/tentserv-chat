import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import * as React from "react";
import { useUserStore } from "@/stores/userStore.ts";
import { useE2eeStore } from "@/stores/e2eeStore.ts";
import { Button } from "@/components/ui/button.tsx";
import { toast } from "sonner";
import { userService } from "@/services/userService.ts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.tsx";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu.tsx";
import { CircleUserRound } from "lucide-react";
import { env } from "@/config/env.ts";

interface NavItem {
    name: string;
    path: string;
    icon?: React.ReactNode;
    requiresBootstrapReady?: boolean;
}

const navItems: NavItem[] = [
    { name: 'Friends', path: '/friends' },
    { name: 'Chat Room', path: '/chat', requiresBootstrapReady: true },
];

interface NavbarProps {
    className?: string;
}

export const Navbar = ({ className }: NavbarProps) => {
    const user = useUserStore((state) => state.currentUser);
    const bootstrapStatus = useE2eeStore((state) => state.bootstrapStatus);
    const navigate = useNavigate();

    const userDisplayName = user?.name ?? "User";
    const chatDisabled = user?.isLoggedIn === true && bootstrapStatus !== 'ready';

    const logout = async () => {
        try {
            await userService.logout();
            toast.success("Logout successfully.");
            navigate('/login', { replace: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Logout failed";
            toast.error(message);
        }
    }

    return (
        <nav className={cn(
            'flex items-center justify-between px-4 ',
            'h-16 w-full shadow-md',
            'bg-navbar-bg text-navbar-text',
            className
        )}>

            {/* Left side: logo, navigator options */}
            <div className="flex items-center gap-8 h-full">

                {/* logo */}
                <Link to="/" className="flex items-center h-full gap-2 hover:opacity-80 transition">
                    <div className="h-full w-12 flex items-center justify-center overflow-hidden">
                        <img
                            src="/goat-chat.svg"
                            alt="logo"
                            className="w-full h-full scale-150"
                        />
                    </div>
                    <h1 className="text-xl font-bold">Tentserv Chat</h1>
                </Link>

                {/* nav options */}
                <div className="flex items-center gap-1 h-full">
                    {navItems.map((item) => {
                        const disabled = item.requiresBootstrapReady && chatDisabled;
                        const itemClassName = cn(
                            "flex items-center gap-2 px-4 h-full",
                            "transition-colors",
                            "bg-navbar-bg text-navbar-text",
                            disabled
                                ? "cursor-not-allowed opacity-50"
                                : "hover:bg-navbar-hover hover:opacity-80",
                        );

                        if (disabled) {
                            return (
                                <button
                                    key={item.path}
                                    type="button"
                                    disabled
                                    title="Chat is unavailable until end-to-end encryption is ready."
                                    className={itemClassName}
                                >
                                    <span className="font-medium">{item.name}</span>
                                </button>
                            );
                        }

                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={itemClassName}
                            >
                                <span className="font-medium">{item.name}</span>
                            </Link>
                        );
                    })}
                </div>

            </div>


            {/* user info */}
            <div className="flex items-center gap-3">
                {user?.isLoggedIn ? (
                    <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{userDisplayName}</p>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    className={cn(
                                        "h-10 w-10 rounded-full p-0.5 text-gray-400",
                                        "transition-colors hover:text-gray-500 focus-visible:outline-none",
                                        "focus-visible:ring-1 focus-visible:ring-ring"
                                    )}
                                    aria-label="Open user menu"
                                >
                                    <Avatar className="h-full w-full">
                                        {user?.avatar && (
                                            <AvatarImage
                                                src={`${env.API_BASE_URL}/static/${user.avatar}`}
                                                alt={`${userDisplayName} avatar`}
                                                className="object-cover"
                                            />
                                        )}
                                        <AvatarFallback>
                                            <CircleUserRound className="h-full w-full"/>
                                        </AvatarFallback>
                                    </Avatar>
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem onClick={() => navigate('/profile')}>
                                    Profile
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled>
                                    Settings
                                </DropdownMenuItem>
                                {(user?.roles ?? []).includes('admin') && (
                                    <>
                                        <DropdownMenuSeparator/>
                                        <DropdownMenuItem onClick={() => navigate('/console')}>
                                            Dashboard
                                        </DropdownMenuItem>
                                    </>
                                )}
                                <DropdownMenuSeparator/>
                                <DropdownMenuItem onClick={() => logout()}>
                                    Logout
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                ) : (
                    <Button size="sm"
                            className={"bg-primary text-primary-foreground"}
                            onClick={() => navigate('/login')}>
                        Login
                    </Button>
                )}
            </div>
        </nav>
    )
}
