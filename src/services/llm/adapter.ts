import type { MessageParam, Tool as AnthropicTool } from '@anthropic-ai/sdk/resources/messages';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { anthropic, openai } from './clients';
import { toOpenAITool } from './utils';
import { Message, Tool, LLMResponse } from '@/types/llm';

export interface LLMAdapter {
    complete(messages: Message[], tools: Tool[]): Promise<LLMResponse>;
}

export class ClaudeAdapter implements LLMAdapter {
    constructor(private model: string = 'claude-sonnet-4-20250514') {
    }

    async complete(messages: Message[], tools: Tool[]): Promise<LLMResponse> {
        const res = await anthropic.messages.create({
            model: this.model,
            max_tokens: 1024,
            messages: messages as MessageParam[],
            tools: tools as AnthropicTool[],
        });

        return {
            text: res.content.find(b => b.type === 'text')?.text ?? null,
            stopReason: res.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
            toolCalls: res.content
                .filter(b => b.type === 'tool_use')
                .map(b => {
                    if (b.type !== 'tool_use') throw new Error();
                    return { id: b.id, name: b.name, input: b.input as Record<string, unknown> };
                }),
        };
    }
}

export class OpenAIAdapter implements LLMAdapter {
    constructor(private model: string = 'gpt-4o') {
    }

    async complete(messages: Message[], tools: Tool[]): Promise<LLMResponse> {
        const res = await openai.chat.completions.create({
            model: this.model,
            messages: messages as ChatCompletionMessageParam[],
            tools: tools.map(toOpenAITool),
        });

        const choice = res.choices[0];
        return {
            text: choice.message.content ?? null,
            stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
            toolCalls: (choice.message.tool_calls ?? [])
                .filter(t => t.type === 'function')
                .map(t => {
                    if (t.type !== 'function') throw new Error();
                    return {
                        id: t.id,
                        name: t.function.name,
                        input: JSON.parse(t.function.arguments) as Record<string, unknown>,
                    };
                }),
        };
    }
}