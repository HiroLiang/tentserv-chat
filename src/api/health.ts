import { get } from "@/api/http.ts";

export const healthApi = {
    check: () => get<unknown>('/api/health'),
};
