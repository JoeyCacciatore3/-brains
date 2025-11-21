import type { FileData } from '@/lib/validation';

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  files?: FileData[];
}

export interface LLMResponse {
  content: string;
  finishReason?: string;
}

export interface LLMProvider {
  name: string;
  stream: (messages: LLMMessage[], onChunk: (chunk: string) => void) => Promise<string>;
}

export interface LLMConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}
