export interface ErrorResponse {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}
