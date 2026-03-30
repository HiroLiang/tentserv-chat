import { participantApi } from '@/api/participant.ts';
import { logger } from '@/utils/logger.ts';

class ChatParticipantService {
    async ensureParticipant(): Promise<void> {
        try {
            await participantApi.getMe();
        } catch {
            logger.info('Participant not found, registering...');
            try {
                await participantApi.registerUser();
            } catch (err) {
                logger.error('Failed to register participant', err);
                throw err;
            }
        }
    }
}

export const chatParticipantService = new ChatParticipantService();
