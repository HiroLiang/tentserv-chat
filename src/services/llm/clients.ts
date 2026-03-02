import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const anthropic = new Anthropic({
    apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
    dangerouslyAllowBrowser: true, // Tauri 桌面 app 可以用
});

export const openai = new OpenAI({
    apiKey: import.meta.env.VITE_OPENAI_API_KEY,
    dangerouslyAllowBrowser: true,
});