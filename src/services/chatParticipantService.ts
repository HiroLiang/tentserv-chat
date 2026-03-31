import { participantApi } from '@/api/participant.ts';
import { useUserStore } from '@/stores/userStore.ts';
import { logger } from '@/utils/logger.ts';

class ChatParticipantService {
    async ensureParticipant(): Promise<void> {
        try {
            const p = await participantApi.getMe();
            useUserStore.getState().setParticipantId(p.id);
        } catch {
            logger.info('Participant not found, registering...');
            try {
                const p = await participantApi.registerUser();
                useUserStore.getState().setParticipantId(p.id);
            } catch (err) {
                logger.error('Failed to register participant', err);
                throw err;
            }
        }
    }
}

export const chatParticipantService = new ChatParticipantService();
