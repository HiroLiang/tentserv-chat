import { ClaudeAdapter, LLMAdapter, OpenAIAdapter } from "@/services/llm/adapter.ts";

export type LLMProvider = 'anthropic' | 'openai';

export interface LLMConfig {
    provider: LLMProvider;
    model: string;
}

export const createLLMAdapter = (config: LLMConfig): LLMAdapter => {
    switch (config.provider) {
        case 'anthropic':
            return new ClaudeAdapter(config.model);
        case 'openai':
            return new OpenAIAdapter(config.model);
        default:
            throw new Error(`Unsupported provider: ${config.provider}`);
    }
};