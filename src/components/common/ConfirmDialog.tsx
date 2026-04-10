import { Button } from '@/components/ui/button.tsx';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog.tsx';
import { cn } from '@/lib/utils.ts';

export interface ConfirmDialogAction {
    label: string;
    onClick?: () => void | Promise<void>;
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost';
    cancel?: boolean;
    disabled?: boolean;
}

interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    actions: ConfirmDialogAction[];
}

export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    actions,
}: ConfirmDialogProps) {
    const vertical = actions.length >= 3;

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className={cn(
                    vertical
                        ? 'flex-col items-stretch justify-start'
                        : 'flex-row items-center justify-end',
                )}>
                    {actions.map((action) => {
                        const Primitive = action.cancel ? AlertDialogCancel : AlertDialogAction;
                        return (
                            <Primitive asChild key={action.label}>
                                <Button
                                    type="button"
                                    variant={action.variant ?? (action.cancel ? 'outline' : 'default')}
                                    onClick={action.onClick}
                                    disabled={action.disabled}
                                    className={cn(vertical && 'w-full')}
                                >
                                    {action.label}
                                </Button>
                            </Primitive>
                        );
                    })}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
