import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenRouterProvider } from '@/lib/llm/providers/openrouter';
import type { LLMMessage } from '@/lib/llm/types';

// Mock fetch globally
global.fetch = vi.fn();

// Mock PDF extraction
vi.mock('@/lib/pdf-extraction', () => ({
  extractTextFromPDF: vi.fn(async (_base64: string) => {
    return 'Extracted PDF text content';
  }),
}));

describe('OpenRouterProvider', () => {
  const apiKey = 'test-openrouter-api-key';
  let provider: OpenRouterProvider;

  beforeEach(() => {
    provider = new OpenRouterProvider(apiKey);
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Mock environment
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
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
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'AI Dialogue Platform',
          }),
        })
      );
    });

    it('should handle PDF files by extracting text', async () => {
      const { extractTextFromPDF } = await import('@/lib/pdf-extraction');
      const mockResponse = createMockStreamResponse(['Response']);
      (global.fetch as any).mockResolvedValue(mockResponse);

      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Test message',
          files: [
            {
              name: 'test.pdf',
              type: 'application/pdf',
              size: 1000,
              base64: 'base64encodedpdf',
            },
          ],
        },
      ];

      await provider.stream(messages, () => {});

      expect(extractTextFromPDF).toHaveBeenCalledWith('base64encodedpdf');
      const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callBody.messages[0].content).toContain('Extracted PDF text content');
    });

    it('should handle non-PDF files by including file info', async () => {
      const mockResponse = createMockStreamResponse(['Response']);
      (global.fetch as any).mockResolvedValue(mockResponse);

      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Test message',
          files: [
            {
              name: 'test.jpg',
              type: 'image/jpeg',
              size: 5000,
              base64: 'base64encodedimage',
            },
          ],
        },
      ];

      await provider.stream(messages, () => {});

      const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callBody.messages[0].content).toContain('[File: test.jpg');
      expect(callBody.messages[0].content).toContain('image/jpeg');
    });

    it('should handle multiple files', async () => {
      const { extractTextFromPDF } = await import('@/lib/pdf-extraction');
      const mockResponse = createMockStreamResponse(['Response']);
      (global.fetch as any).mockResolvedValue(mockResponse);

      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Test message',
          files: [
            {
              name: 'test1.pdf',
              type: 'application/pdf',
              size: 1000,
              base64: 'base64pdf1',
            },
            {
              name: 'test2.jpg',
              type: 'image/jpeg',
              size: 2000,
              base64: 'base64image',
            },
          ],
        },
      ];

      await provider.stream(messages, () => {});

      expect(extractTextFromPDF).toHaveBeenCalledTimes(1);
      const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callBody.messages[0].content).toContain('Extracted PDF text content');
      expect(callBody.messages[0].content).toContain('[File: test2.jpg');
    });

    it('should handle PDF extraction errors gracefully', async () => {
      const { extractTextFromPDF } = await import('@/lib/pdf-extraction');
      vi.mocked(extractTextFromPDF).mockRejectedValueOnce(new Error('PDF extraction failed'));

      const mockResponse = createMockStreamResponse(['Response']);
      (global.fetch as any).mockResolvedValue(mockResponse);

      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Test message',
          files: [
            {
              name: 'test.pdf',
              type: 'application/pdf',
              size: 1000,
              base64: 'base64encodedpdf',
            },
          ],
        },
      ];

      // Should not throw, should continue with file info
      await expect(provider.stream(messages, () => {})).resolves.toBeDefined();
      const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callBody.messages[0].content).toContain('PDF text extraction failed');
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

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Failed to fetch'));

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      await expect(provider.stream(messages, () => {})).rejects.toThrow('Network error');
    });

    it('should apply custom config', () => {
      const customProvider = new OpenRouterProvider(apiKey, {
        model: 'custom-model',
        maxTokens: 2000,
        temperature: 0.9,
      });

      expect(customProvider).toBeDefined();
    });

    it('should retry with fallback model when model is unavailable (404)', async () => {
      // First attempt fails with 404 (model unavailable)
      const unavailableResponse = {
        ok: false,
        status: 404,
        json: async () => ({
          error: { message: 'Model not found' },
        }),
      };

      // Second attempt succeeds with fallback model
      const successResponse = createMockStreamResponse(['Fallback response']);

      (global.fetch as any)
        .mockResolvedValueOnce(unavailableResponse)
        .mockResolvedValueOnce(successResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      const chunks: string[] = [];
      const result = await provider.stream(messages, (chunk) => {
        chunks.push(chunk);
      });

      expect(result).toBe('Fallback response');
      expect(chunks).toEqual(['Fallback response']);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry with fallback model when error message indicates model unavailable', async () => {
      // First attempt fails with model unavailable error message
      const unavailableResponse = {
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'Model unavailable or does not exist' },
        }),
      };

      // Second attempt succeeds with fallback model
      const successResponse = createMockStreamResponse(['Fallback response']);

      (global.fetch as any)
        .mockResolvedValueOnce(unavailableResponse)
        .mockResolvedValueOnce(successResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      const chunks: string[] = [];
      const result = await provider.stream(messages, (chunk) => {
        chunks.push(chunk);
      });

      expect(result).toBe('Fallback response');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-model errors (rate limit)', async () => {
      const rateLimitResponse = {
        ok: false,
        status: 429,
        json: async () => ({
          error: { message: 'Rate limit exceeded' },
        }),
      };

      (global.fetch as any).mockResolvedValue(rateLimitResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      await expect(provider.stream(messages, () => {})).rejects.toThrow('Rate limit exceeded');
      // Should only try once, not retry
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on non-model errors (auth)', async () => {
      const authErrorResponse = {
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: 'Invalid API key' },
        }),
      };

      (global.fetch as any).mockResolvedValue(authErrorResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      await expect(provider.stream(messages, () => {})).rejects.toThrow('Invalid API key');
      // Should only try once, not retry
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw error when all models are unavailable', async () => {
      const unavailableResponse = {
        ok: false,
        status: 404,
        json: async () => ({
          error: { message: 'Model not found' },
        }),
      };

      // Mock all attempts to fail
      (global.fetch as any).mockResolvedValue(unavailableResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      await expect(provider.stream(messages, () => {})).rejects.toThrow('All OpenRouter models are unavailable');
      // Should try up to max attempts (5)
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });

    it('should use custom fallback models from environment variable', async () => {
      const originalEnv = process.env.OPENROUTER_FALLBACK_MODELS;
      process.env.OPENROUTER_FALLBACK_MODELS = JSON.stringify(['custom-model-1', 'custom-model-2']);

      // Create new provider to pick up env variable
      const customProvider = new OpenRouterProvider(apiKey);

      // First model fails
      const unavailableResponse = {
        ok: false,
        status: 404,
        json: async () => ({
          error: { message: 'Model not found' },
        }),
      };

      // Second model (first fallback) succeeds
      const successResponse = createMockStreamResponse(['Custom fallback response']);

      (global.fetch as any)
        .mockResolvedValueOnce(unavailableResponse)
        .mockResolvedValueOnce(successResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      await customProvider.stream(messages, () => {});

      // Restore original env
      if (originalEnv) {
        process.env.OPENROUTER_FALLBACK_MODELS = originalEnv;
      } else {
        delete process.env.OPENROUTER_FALLBACK_MODELS;
      }

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should prevent infinite loops by limiting max attempts', async () => {
      const unavailableResponse = {
        ok: false,
        status: 404,
        json: async () => ({
          error: { message: 'Model not found' },
        }),
      };

      (global.fetch as any).mockResolvedValue(unavailableResponse);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test message' }];

      await expect(provider.stream(messages, () => {})).rejects.toThrow();

      // Should not exceed max attempts (5)
      expect(global.fetch).toHaveBeenCalledTimes(5);
      expect((global.fetch as any).mock.calls.length).toBeLessThanOrEqual(5);
    });
  });
});

// Helper functions
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
