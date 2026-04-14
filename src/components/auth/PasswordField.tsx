import {
    forwardRef,
    type ComponentProps,
    type KeyboardEvent,
    type PointerEvent,
    useState,
} from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/lib/utils.ts";

interface PasswordFieldProps extends Omit<ComponentProps<typeof Input>, "type"> {
    label: string;
    error?: string;
    inputClassName?: string;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
    ({ className, inputClassName, id, label, error, ...props }, ref) => {
        const [revealed, setRevealed] = useState(false);

        const showPassword = () => setRevealed(true);
        const hidePassword = () => setRevealed(false);

        const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
            event.preventDefault();
            showPassword();
        };

        const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
            if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                showPassword();
            }
        };

        const iconClassName = "h-4 w-4";

        return (
            <div className={cn("space-y-2", className)}>
                <label htmlFor={id} className="block text-sm font-medium text-card-foreground mb-2">
                    {label}
                </label>
                <div className="relative">
                    <Input
                        {...props}
                        ref={ref}
                        id={id}
                        type={revealed ? "text" : "password"}
                        className={cn("pr-10", inputClassName)}
                    />
                    <button
                        type="button"
                        aria-label={`Show ${label.toLowerCase()} while pressed`}
                        aria-pressed={revealed}
                        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        onPointerDown={handlePointerDown}
                        onPointerUp={hidePassword}
                        onPointerLeave={hidePassword}
                        onPointerCancel={hidePassword}
                        onKeyDown={handleKeyDown}
                        onKeyUp={hidePassword}
                        onBlur={hidePassword}
                    >
                        {revealed ? <EyeOff className={iconClassName} /> : <Eye className={iconClassName} />}
                    </button>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
        );
    },
);

PasswordField.displayName = "PasswordField";
