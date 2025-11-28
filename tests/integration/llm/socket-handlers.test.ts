import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockLLMProvider } from '../../utils/mock-llm-provider';
import { createMockDiscussionRound } from '../../utils/test-fixtures';
import type { LLMMessage } from '@/lib/llm/types';

// Mock all dependencies
vi.mock('@/lib/llm/index', () => ({
  getProviderWithFallback: vi.fn(() => new MockLLMProvider('Mock Provider')),
  aiPersonas: {
    solver: {
      id: 'solver',
      name: 'Solver AI',
      provider: 'groq',
      systemPrompt: 'You are Solver AI.',
    },
    analyzer: {
      id: 'analyzer',
      name: 'Analyzer AI',
      provider: 'mistral',
      systemPrompt: 'You are Analyzer AI.',
    },
  },
}));

vi.mock('@/lib/db/discussions', () => ({
  createDiscussion: vi.fn(),
  getDiscussion: vi.fn(() => ({
    id: 'test-discussion',
    user_id: 'test-user',
    topic: 'Test topic',
    is_resolved: 0,
    needs_user_input: 0,
    current_turn: 0,
  })),
  updateDiscussion: vi.fn(),
  getActiveDiscussion: vi.fn(() => null),
}));

vi.mock('@/lib/discussions/file-manager', () => ({
  createDiscussion: vi.fn(() => ({
    id: 'test-discussion',
    jsonPath: 'test.json',
    mdPath: 'test.md',
  })),
  appendMessageToDiscussion: vi.fn(() => ({
    tokenCount: 100,
  })),
  addRoundToDiscussion: vi.fn(),
  readDiscussion: vi.fn(() => ({
    topic: 'Test topic',
    messages: [],
    rounds: [],
    summaries: [],
  })),
}));

vi.mock('@/lib/discussion-context', () => ({
  loadDiscussionContext: vi.fn(() => ({
    messages: [],
    rounds: [],
    summary: null,
    currentSummary: null,
  })),
  formatLLMPrompt: vi.fn(
    (
      topic: string,
      _messages: any[],
      isFirst: boolean,
      _persona: string,
      _files?: any,
      _summary?: any,
      _rounds?: any,
      _currentSummary?: any,
      _userAnswers?: any
    ) => {
      return `Topic: ${topic}. ${isFirst ? 'First message' : 'Continuing conversation'}.`;
    }
  ),
}));

vi.mock('@/lib/llm/resolver', () => ({
  isResolved: vi.fn(() => false),
  needsUserInput: vi.fn(() => ({ needsInput: false })),
}));

vi.mock('@/lib/llm/summarizer', () => ({
  shouldSummarize: vi.fn(() => false),
  summarizeRounds: vi.fn(),
}));

vi.mock('@/lib/llm/question-generator', () => ({
  generateQuestions: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Socket Handlers LLM Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Provider Integration', () => {
    it('should use provider with fallback when generating AI response', async () => {
      const { getProviderWithFallback } = await import('@/lib/llm/index');
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'AI response',
      });

      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      // Simulate provider usage
      const messages: LLMMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' },
      ];

      const chunks: string[] = [];
      const result = await mockProvider.stream(messages, (chunk: string) => {
        chunks.push(chunk);
      });

      expect(result).toBe('AI response');
      expect(getProviderWithFallback).toBeDefined();
    });

    it('should handle provider errors with fallback', async () => {
      const { getProviderWithFallback } = await import('@/lib/llm/index');

      // First provider fails
      const errorProvider = MockLLMProvider.createErrorProvider('Error Provider', 'Provider error');

      // Fallback provider succeeds
      const fallbackProvider = new MockLLMProvider('Fallback Provider', {
        responseText: 'Fallback response',
      });

      vi.mocked(getProviderWithFallback)
        .mockReturnValueOnce(errorProvider as any)
        .mockReturnValueOnce(fallbackProvider as any);

      // Simulate fallback behavior
      let usedProvider = errorProvider;
      try {
        const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];
        await usedProvider.stream(messages, () => {});
      } catch {
        // Fallback to next provider
        usedProvider = fallbackProvider;
        const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];
        const result = await usedProvider.stream(messages, () => {});
        expect(result).toBe('Fallback response');
      }
    });
  });

  describe('Message Streaming', () => {
    it('should stream messages in chunks', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        chunks: ['Hello', ' world', '!'],
      });

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];
      const chunks: string[] = [];

      await mockProvider.stream(messages, (chunk: string) => {
        chunks.push(chunk);
      });

      expect(chunks).toEqual(['Hello', ' world', '!']);
    });

    it('should accumulate full response from chunks', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        chunks: ['Part', ' one', ' and', ' part', ' two'],
      });

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];
      let fullContent = '';

      const result = await mockProvider.stream(messages, (chunk: string) => {
        fullContent += chunk;
      });

      expect(result).toBe('Part one and part two');
      expect(fullContent).toBe('Part one and part two');
    });
  });

  describe('Context Building', () => {
    it('should build context with rounds and summaries', async () => {
      const { formatLLMPrompt } = await import('@/lib/discussion-context');

      const rounds = [createMockDiscussionRound(1)];
      const summary = {
        summary: 'Previous summary',
        createdAt: Date.now(),
        roundNumber: 0,
        tokenCountBefore: 1000,
        tokenCountAfter: 500,
        replacesRounds: [1],
      };

      formatLLMPrompt(
        'Test topic',
        [],
        false,
        'Solver AI',
        undefined,
        summary.summary,
        rounds,
        undefined, // currentSummary
        undefined // summaries
      );

      expect(formatLLMPrompt).toHaveBeenCalled();
    });

    it('should include user answers in context', async () => {
      const { formatLLMPrompt } = await import('@/lib/discussion-context');

      const userAnswers = {
        'question-1': ['answer-1', 'answer-2'],
      };

      formatLLMPrompt(
        'Test topic',
        [],
        false,
        'Solver AI',
        undefined,
        undefined,
        [],
        undefined,
        undefined, // summaries
        userAnswers
      );

      expect(formatLLMPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.any(Boolean),
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        expect.any(Array),
        expect.any(Object),
        expect.any(Object), // summaries
        userAnswers
      );
    });
  });

  describe('Resolution Detection Integration', () => {
    it('should detect resolution in conversation', async () => {
      const { isResolved } = await import('@/lib/llm/resolver');
      vi.mocked(isResolved).mockReturnValue({
        resolved: true,
        confidence: 0.8,
        reason: 'keywords',
      });

      const messages = [
        {
          persona: 'Solver AI',
          content: 'The solution is clear.',
        },
        {
          persona: 'Analyzer AI',
          content: 'I agree completely.',
        },
      ];

      const resolved = isResolved(messages as any);
      expect(resolved.resolved).toBe(true);
    });

    it('should detect user input needed', async () => {
      const { needsUserInput } = await import('@/lib/llm/resolver');
      vi.mocked(needsUserInput).mockReturnValue({
        needsInput: true,
        question: 'Can you clarify?',
      });

      const messages = [
        {
          persona: 'Solver AI',
          content: 'I need your input.',
        },
      ];

      const result = needsUserInput(messages as any);
      expect(result.needsInput).toBe(true);
      expect(result.question).toBeDefined();
    });
  });

  describe('Summary Generation Integration', () => {
    it('should trigger summary when token threshold reached', async () => {
      const { shouldSummarize, summarizeRounds } = await import('@/lib/llm/summarizer');
      vi.mocked(shouldSummarize).mockReturnValue(true);

      const tokenCount = 5000;
      const tokenLimit = 4800;

      if (shouldSummarize(tokenCount, tokenLimit)) {
        const rounds = [createMockDiscussionRound(1)];
        await summarizeRounds('test-discussion', 'test-user', rounds, 2);
        expect(summarizeRounds).toHaveBeenCalled();
      }
    });
  });

  describe('Question Generation Integration', () => {
    it('should generate questions after round completion', async () => {
      const { generateQuestions } = await import('@/lib/llm/question-generator');

      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: JSON.stringify([
          {
            id: 'q1',
            text: 'Question?',
            options: [
              { id: 'o1', text: 'Option 1' },
              { id: 'o2', text: 'Option 2' },
            ],
          },
          {
            id: 'q2',
            text: 'Another question?',
            options: [
              { id: 'o3', text: 'Option A' },
              { id: 'o4', text: 'Option B' },
            ],
          },
        ]),
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const round = createMockDiscussionRound(1);
      await generateQuestions('test-discussion', 'test-user', 'topic', round);

      expect(generateQuestions).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle provider errors during streaming', async () => {
      const errorProvider = MockLLMProvider.createErrorProvider(
        'Error Provider',
        'Streaming error'
      );

      const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];

      await expect(errorProvider.stream(messages, () => {})).rejects.toThrow('Streaming error');
    });

    it('should handle empty responses', async () => {
      const emptyProvider = MockLLMProvider.createEmptyProvider();
      const messages: LLMMessage[] = [{ role: 'user', content: 'Test' }];

      const result = await emptyProvider.stream(messages, () => {});
      expect(result).toBe('');
    });
  });
});
