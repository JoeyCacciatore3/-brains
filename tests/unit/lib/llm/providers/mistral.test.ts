import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MistralProvider } from '@/lib/llm/providers/mistral';
import type { LLMMessage } from '@/lib/llm/types';

// Mock fetch globally
global.fetch = vi.fn();

describe('MistralProvider', () => {
  const apiKey = 'test-mistral-api-key';
  let provider: MistralProvider;

  beforeEach(() => {
    provider = new MistralProvider(apiKey);
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('stream', () => {
    it('should successfully stream response with chunks', async () => {
      const mockChunks = ['Hello', ' world', '!'];
      const mockResponse = createMockStreamResponse(mockChunks);

      (global.fetch as any).mockResolvedValue(mockResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      const chunks: string[] = [];
      const result = await provider.stream(messages, (chunk) => {
        chunks.push(chunk);
      });

      expect(result).toBe('Hello world!');
      expect(chunks).toEqual(mockChunks);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.mistral.ai/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should handle empty response', async () => {
      const mockResponse = createMockStreamResponse([]);
      (global.fetch as any).mockResolvedValue(mockResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      const chunks: string[] = [];
      const result = await provider.stream(messages, (chunk) => {
        chunks.push(chunk);
      });

      expect(result).toBe('');
      expect(chunks).toEqual([]);
    });

    it('should handle timeout', async () => {
      const mockResponse = createMockStreamResponse(['Test'], 100);
      (global.fetch as any).mockResolvedValue(mockResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      const streamPromise = provider.stream(messages, () => {});
      vi.advanceTimersByTime(61000);

      await expect(streamPromise).rejects.toThrow('Request timeout');
    });

    it('should handle 401 API key error', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: 'Invalid API key' },
        }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      await expect(provider.stream(messages, () => {})).rejects.toThrow('Invalid API key');
    });

    it('should handle 429 rate limit error', async () => {
      const mockResponse = {
        ok: false,
        status: 429,
        json: async () => ({
          error: { message: 'Rate limit exceeded' },
        }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      await expect(provider.stream(messages, () => {})).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle 500 service unavailable error', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        json: async () => ({
          error: { message: 'Internal server error' },
        }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      await expect(provider.stream(messages, () => {})).rejects.toThrow('temporarily unavailable');
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Failed to fetch'));

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      await expect(provider.stream(messages, () => {})).rejects.toThrow('Network error');
    });

    it('should handle invalid JSON chunks gracefully', async () => {
      const mockReader = createMockReader([
        'data: invalid json\n',
        'data: {"choices":[{"delta":{"content":"Valid"}}]}\n',
        'data: [DONE]\n',
      ]);
      const mockResponse = {
        ok: true,
        body: { getReader: () => mockReader },
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      const chunks: string[] = [];
      const result = await provider.stream(messages, (chunk) => {
        chunks.push(chunk);
      });

      expect(chunks).toContain('Valid');
      expect(result).toContain('Valid');
    });

    it('should apply custom config', () => {
      const customProvider = new MistralProvider(apiKey, {
        model: 'custom-model',
        maxTokens: 2000,
        temperature: 0.9,
      });

      expect(customProvider).toBeDefined();
    });
  });
});

// Helper functions (same as groq.test.ts)
function createMockStreamResponse(
  chunks: string[],
  delay: number = 0,
  includeDone: boolean = true
): Response {
  const streamChunks = chunks.map((chunk) => ({
    done: false,
    value: new TextEncoder().encode(`data: {"choices":[{"delta":{"content":"${chunk}"}}]}\n`),
  }));

  if (includeDone) {
    streamChunks.push({
      done: false,
      value: new TextEncoder().encode('data: [DONE]\n'),
    });
  }

  streamChunks.push({ done: true, value: new Uint8Array() });

  let index = 0;
  const reader = {
    read: async () => {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return streamChunks[index++] || { done: true, value: new Uint8Array() };
    },
    releaseLock: vi.fn(),
  };

  return {
    ok: true,
    body: {
      getReader: () => reader,
    },
  } as any;
}

function createMockReader(lines: string[]): ReadableStreamDefaultReader {
  let index = 0;
  return {
    read: async () => {
      if (index >= lines.length) {
        return { done: true, value: new Uint8Array() };
      }
      const line = lines[index++];
      return {
        done: false,
        value: new TextEncoder().encode(line),
      };
    },
    releaseLock: vi.fn(),
  } as any;
}
