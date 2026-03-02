import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';

export type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';

export interface LLMResponse {
    text: string | null;
    toolCalls: ToolCall[];
    stopReason: 'end_turn' | 'tool_use';
}

export interface ToolCall {
    id: string;
    name: string;
    input: Record<string, unknown>;
}

// ===== Tool =====
export interface ToolInputSchema {
    type: 'object';
    properties: Record<string, {
        type: 'string' | 'number' | 'boolean' | 'array' | 'object';
        description?: string;
        enum?: string[];
        items?: { type: string };
    }>;
    required?: string[];

    [key: string]: unknown;
}

export interface Tool {
    name: string;
    description: string;
    input_schema: ToolInputSchema;
}

// ===== Message =====
export type TextBlock = {
    type: 'text';
    text: string;
};

export type ToolResultBlock = {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
};

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
}