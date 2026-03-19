import { get, post } from "@/api/http.ts";
import type { ParticipantResponse } from "@/api/types.ts";

export const participantApi = {
    getMe: () =>
        get<ParticipantResponse>('/api/participant/me'),

    registerUser: () =>
        post<ParticipantResponse>('/api/participant/user'),
};
