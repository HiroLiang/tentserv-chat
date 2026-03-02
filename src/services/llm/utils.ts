import { Tool } from '@/types/llm';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const toOpenAITool = (tool: Tool): ChatCompletionTool => ({
    type: 'function',
    function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema as Record<string, unknown>,
    },
});