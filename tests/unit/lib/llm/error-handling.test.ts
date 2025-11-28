import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockLLMProvider } from '../../../../tests/utils/mock-llm-provider';
import { getLLMProvider, getProviderWithFallback } from '@/lib/llm/index';
import { generateQuestions } from '@/lib/llm/question-generator';
import { generateSummary, generateComprehensiveSummary } from '@/lib/llm/summarizer';
import { createMockDiscussionRound } from '../../../../tests/utils/test-fixtures';
import type { LLMMessage } from '@/lib/llm/types';

describe('LLM Error Handling', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  describe('Provider Initialization Errors', () => {
    it('should handle missing API keys gracefully', () => {
      delete process.env.GROQ_API_KEY;
      delete process.env.MISTRAL_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      expect(() => getLLMProvider('groq')).toThrow('GROQ_API_KEY is not set');
      expect(() => getLLMProvider('mistral')).toThrow('MISTRAL_API_KEY is not set');
      expect(() => getLLMProvider('openrouter')).toThrow('OPENROUTER_API_KEY is not set');
    });

    it('should handle all providers failing in fallback chain', () => {
      delete process.env.GROQ_API_KEY;
      delete process.env.MISTRAL_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      expect(() => getProviderWithFallback('groq')).toThrow('No available LLM providers');
    });
  });

  describe('Streaming Errors', () => {
    it('should handle network errors during streaming', async () => {
      const errorProvider = MockLLMProvider.createErrorProvider(
        'Error Provider',
        'Network error: Failed to fetch'
      );

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];

      await expect(errorProvider.stream(messages, () => {})).rejects.toThrow('Network error');
    });

    it('should handle timeout errors', async () => {
      const errorProvider = MockLLMProvider.createErrorProvider(
        'Timeout Provider',
        'Request timeout: The AI took too long to respond'
      );

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];

      await expect(errorProvider.stream(messages, () => {})).rejects.toThrow('timeout');
    });

    it('should handle API rate limit errors', async () => {
      const errorProvider = MockLLMProvider.createErrorProvider(
        'Rate Limit Provider',
        'Rate limit exceeded. Please try again in a moment.'
      );

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];

      await expect(errorProvider.stream(messages, () => {})).rejects.toThrow('Rate limit');
    });

    it('should handle service unavailable errors', async () => {
      const errorProvider = MockLLMProvider.createErrorProvider(
        'Unavailable Provider',
        'Service is temporarily unavailable. Please try again later.'
      );

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];

      await expect(errorProvider.stream(messages, () => {})).rejects.toThrow();
    });
  });

  describe('Question Generation Errors', () => {
    it('should handle empty responses from question generator', async () => {
      const emptyProvider = MockLLMProvider.createEmptyProvider();
      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(emptyProvider as any);

      const currentRound = createMockDiscussionRound(1);

      await expect(
        generateQuestions('test-discussion', 'test-user', 'topic', currentRound)
      ).rejects.toThrow('empty response');
    });

    it('should handle invalid JSON from question generator', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'This is not valid JSON {',
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const currentRound = createMockDiscussionRound(1);

      await expect(
        generateQuestions('test-discussion', 'test-user', 'topic', currentRound)
      ).rejects.toThrow('invalid JSON format');
    });

    it('should handle provider errors during question generation', async () => {
      const errorProvider = MockLLMProvider.createErrorProvider('Error Provider', 'Provider error');

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(errorProvider as any);

      const currentRound = createMockDiscussionRound(1);

      await expect(
        generateQuestions('test-discussion', 'test-user', 'topic', currentRound)
      ).rejects.toThrow();
    });
  });

  describe('Summary Generation Errors', () => {
    it('should handle empty responses from summarizer', async () => {
      const emptyProvider = MockLLMProvider.createEmptyProvider();
      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(emptyProvider as any);

      const messages = [
        {
          persona: 'Solver AI',
          content: 'Test message',
          timestamp: new Date().toISOString(),
        },
      ];

      await expect(
        generateSummary('test-discussion', 'test-user', 'topic', messages)
      ).rejects.toThrow('empty response');
    });

    it('should handle provider errors during summary generation', async () => {
      const errorProvider = MockLLMProvider.createErrorProvider('Error Provider', 'Provider error');

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(errorProvider as any);

      const rounds = [createMockDiscussionRound(1)];

      await expect(
        generateComprehensiveSummary('test-discussion', 'test-user', 'topic', rounds, [], 2)
      ).rejects.toThrow();
    });
  });

  describe('Invalid Response Format Errors', () => {
    it('should handle non-string chunks gracefully', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        chunks: ['Valid', null as any, 'chunk'],
      });

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];
      const chunks: string[] = [];

      // Should handle non-string chunks
      try {
        await mockProvider.stream(messages, (chunk: string) => {
          if (typeof chunk === 'string') {
            chunks.push(chunk);
          }
        });
      } catch (error) {
        // May throw or handle gracefully depending on implementation
      }

      // Should still process valid chunks
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle malformed JSON in responses', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: '{"incomplete": json',
      });

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];

      // Should not crash on malformed JSON in content
      const result = await mockProvider.stream(messages, () => {});
      expect(typeof result).toBe('string');
    });
  });

  describe('Edge Case Error Handling', () => {
    it('should handle very long responses', async () => {
      const longText = 'A'.repeat(100000);
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: longText,
      });

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];
      let chunkCount = 0;

      const result = await mockProvider.stream(messages, () => {
        chunkCount++;
      });

      expect(result.length).toBe(100000);
      expect(chunkCount).toBeGreaterThan(0);
    });

    it('should handle empty messages array', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'Response',
      });

      const messages: any[] = [];

      // Should handle empty messages
      const result = await mockProvider.stream(messages, () => {});
      expect(result).toBeDefined();
    });

    it('should handle special characters in error messages', async () => {
      const errorProvider = MockLLMProvider.createErrorProvider(
        'Error Provider',
        'Error with special chars: <>&"\''
      );

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];

      await expect(errorProvider.stream(messages, () => {})).rejects.toThrow();
    });
  });
});
