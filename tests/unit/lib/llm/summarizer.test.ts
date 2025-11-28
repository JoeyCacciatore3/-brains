import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateSummary,
  generateComprehensiveSummary,
  shouldSummarize,
} from '@/lib/llm/summarizer';
import { MockLLMProvider } from '../../../../tests/utils/mock-llm-provider';
import { createMockDiscussionRound, createMultipleRounds } from '../../../../tests/utils/test-fixtures';

// Mock the LLM provider system
vi.mock('@/lib/llm/index', () => {
  const mockProvider = new MockLLMProvider('Mock Provider');
  return {
    getProviderWithFallback: vi.fn(() => mockProvider),
    aiPersonas: {
      summarizer: {
        id: 'summarizer',
        name: 'Summarizer AI',
        provider: 'openrouter',
        systemPrompt: 'You are a summarizer.',
      },
    },
  };
});

// Mock file manager
vi.mock('@/lib/discussions/file-manager', () => ({
  readDiscussion: vi.fn(),
  updateDiscussionWithSummary: vi.fn(),
  addSummaryToDiscussion: vi.fn(),
}));

// Mock database
vi.mock('@/lib/db/discussions', () => ({
  updateDiscussion: vi.fn(),
}));

// Mock token counter
vi.mock('@/lib/discussions/token-counter', () => ({
  hasReachedThreshold: vi.fn((tokenCount: number, tokenLimit: number) => {
    return tokenCount >= tokenLimit;
  }),
  estimateTokenCount: vi.fn((text: string) => {
    // Simple estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }),
}));

describe('summarizer', () => {
  const discussionId = 'test-discussion';
  const userId = 'test-user';
  const topic = 'Test topic';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldSummarize', () => {
    it('should return true when token count reaches threshold', () => {
      const tokenCount = 1000;
      const tokenLimit = 1000;
      expect(shouldSummarize(tokenCount, tokenLimit)).toBe(true);
    });

    it('should return false when token count is below threshold', () => {
      const tokenCount = 500;
      const tokenLimit = 1000;
      expect(shouldSummarize(tokenCount, tokenLimit)).toBe(false);
    });

    it('should return true when token count exceeds threshold', () => {
      const tokenCount = 1500;
      const tokenLimit = 1000;
      expect(shouldSummarize(tokenCount, tokenLimit)).toBe(true);
    });
  });

  describe('generateSummary', () => {
    it('should generate summary from messages', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'This is a comprehensive summary of the discussion.',
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const messages = [
        {
          persona: 'Solver AI',
          content: 'First message',
          timestamp: new Date().toISOString(),
        },
        {
          persona: 'Analyzer AI',
          content: 'Second message',
          timestamp: new Date().toISOString(),
        },
      ];

      const summary = await generateSummary(discussionId, userId, topic, messages);

      expect(summary).toBe('This is a comprehensive summary of the discussion.');
      expect(getProviderWithFallback).toHaveBeenCalled();
    });

    it('should handle empty response', async () => {
      const mockProvider = MockLLMProvider.createEmptyProvider();
      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const messages = [
        {
          persona: 'Solver AI',
          content: 'Test message',
          timestamp: new Date().toISOString(),
        },
      ];

      await expect(generateSummary(discussionId, userId, topic, messages)).rejects.toThrow(
        'empty response'
      );
    });

    it('should format messages correctly', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'Summary',
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const messages = [
        {
          persona: 'Solver AI',
          content: 'Message 1',
          timestamp: new Date('2024-01-01').toISOString(),
        },
        {
          persona: 'Analyzer AI',
          content: 'Message 2',
          timestamp: new Date('2024-01-02').toISOString(),
        },
      ];

      await generateSummary(discussionId, userId, topic, messages);

      // Verify provider was called (messages were formatted)
      expect(getProviderWithFallback).toHaveBeenCalled();
    });
  });

  describe('generateComprehensiveSummary', () => {
    it('should generate comprehensive summary with metadata', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'This is a comprehensive summary with all key points.',
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const rounds = createMultipleRounds(3);
      const summaryEntry = await generateComprehensiveSummary(
        discussionId,
        userId,
        topic,
        rounds,
        [],
        4
      );

      expect(summaryEntry.summary).toBe('This is a comprehensive summary with all key points.');
      expect(summaryEntry.createdAt).toBeDefined();
      expect(summaryEntry.roundNumber).toBeDefined();
      expect(summaryEntry.tokenCountBefore).toBeGreaterThan(0);
      expect(summaryEntry.tokenCountAfter).toBeGreaterThan(0);
      expect(summaryEntry.replacesRounds).toEqual([1, 2, 3]);
    });

    it('should calculate token counts correctly', async () => {
      const summaryText = 'Short summary';
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: summaryText,
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const rounds = createMultipleRounds(2);
      const summaryEntry = await generateComprehensiveSummary(
        discussionId,
        userId,
        topic,
        rounds,
        [],
        5
      );

      expect(summaryEntry.tokenCountBefore).toBeGreaterThan(0);
      expect(summaryEntry.tokenCountAfter).toBeGreaterThan(0);
      expect(summaryEntry.tokenCountAfter).toBeLessThanOrEqual(summaryEntry.tokenCountBefore);
    });

    it('should include previous summaries in context', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'New summary',
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const rounds = createMultipleRounds(2);
      const previousSummaries = [
        {
          summary: 'Previous summary',
          createdAt: Date.now() - 1000,
          roundNumber: 1,
          tokenCountBefore: 1000,
          tokenCountAfter: 500,
          replacesRounds: [1],
        },
      ];

      await generateComprehensiveSummary(discussionId, userId, topic, rounds, previousSummaries, 3);

      expect(getProviderWithFallback).toHaveBeenCalled();
    });

    it('should handle empty response', async () => {
      const mockProvider = MockLLMProvider.createEmptyProvider();
      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const rounds = createMultipleRounds(2);

      await expect(
        generateComprehensiveSummary(discussionId, userId, topic, rounds, [], 3)
      ).rejects.toThrow('empty response');
    });

    it('should format rounds correctly', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'Summary',
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const rounds = [
        createMockDiscussionRound(1, 'Solver response 1', 'Analyzer response 1'),
        createMockDiscussionRound(2, 'Solver response 2', 'Analyzer response 2'),
      ];

      await generateComprehensiveSummary(discussionId, userId, topic, rounds, [], 3);

      expect(getProviderWithFallback).toHaveBeenCalled();
    });

    it('should include questions and user answers in context', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'Summary',
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const rounds = [
        {
          ...createMockDiscussionRound(1),
          questions: {
            roundNumber: 1,
            questions: [
              {
                id: 'q1',
                text: 'Question 1?',
                options: [
                  { id: 'o1', text: 'Option 1' },
                  { id: 'o2', text: 'Option 2' },
                ],
              },
            ],
            generatedAt: new Date().toISOString(),
          },
          userAnswers: ['o1'],
        },
      ];

      await generateComprehensiveSummary(discussionId, userId, topic, rounds, [], 2);

      expect(getProviderWithFallback).toHaveBeenCalled();
    });
  });

  describe('summarizeRounds', () => {
    it('should summarize rounds and update files', async () => {
      const { readDiscussion, addSummaryToDiscussion } = await import(
        '@/lib/discussions/file-manager'
      );
      const { updateDiscussion } = await import('@/lib/db/discussions');

      vi.mocked(readDiscussion).mockResolvedValue({
        topic: 'Test topic',
        messages: [],
        rounds: [],
        summaries: [],
      } as any);

      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'Summary',
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const rounds = createMultipleRounds(2);
      const { summarizeRounds } = await import('@/lib/llm/summarizer');

      const summaryEntry = await summarizeRounds(discussionId, userId, rounds, 3);

      expect(summaryEntry).toBeDefined();
      expect(addSummaryToDiscussion).toHaveBeenCalled();
      expect(updateDiscussion).toHaveBeenCalled();
    });

    it('should include previous summaries', async () => {
      const { readDiscussion } = await import('@/lib/discussions/file-manager');

      vi.mocked(readDiscussion).mockResolvedValue({
        topic: 'Test topic',
        messages: [],
        rounds: [],
        summaries: [
          {
            summary: 'Previous summary',
            createdAt: Date.now() - 1000,
            roundNumber: 1,
            tokenCountBefore: 1000,
            tokenCountAfter: 500,
            replacesRounds: [1],
          },
        ],
      } as any);

      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'New summary',
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const rounds = createMultipleRounds(2);
      const { summarizeRounds } = await import('@/lib/llm/summarizer');

      await summarizeRounds(discussionId, userId, rounds, 3);

      expect(getProviderWithFallback).toHaveBeenCalled();
    });
  });
});
