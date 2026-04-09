import { type ReactNode, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useE2eeStore } from '@/stores/e2eeStore.ts';
import { useUserStore } from '@/stores/userStore.ts';

interface Props {
    children: ReactNode;
}

export const ChatAvailabilityRoute = ({ children }: Props) => {
    const user = useUserStore((state) => state.currentUser);
    const bootstrapStatus = useE2eeStore((state) => state.bootstrapStatus);

    useEffect(() => {
        if (user?.isLoggedIn && bootstrapStatus === 'failed') {
            toast.warning('Chat is unavailable until end-to-end encryption is ready.', {
                id: 'chat-unavailable',
            });
        }
    }, [bootstrapStatus, user?.isLoggedIn]);

    if (user?.isLoggedIn && bootstrapStatus !== 'ready') {
        return <Navigate to="/" replace/>;
    }

    return <>{children}</>;
};
