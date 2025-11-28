import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockLLMProvider } from '../../utils/mock-llm-provider';
import { createMockDiscussionRound, createMultipleRounds } from '../../utils/test-fixtures';
import { isResolved, needsUserInput } from '@/lib/llm/resolver';
import { generateQuestions } from '@/lib/llm/question-generator';
import { generateComprehensiveSummary, shouldSummarize } from '@/lib/llm/summarizer';

// Mock LLM providers
vi.mock('@/lib/llm/index', async () => {
  const actual = await vi.importActual('@/lib/llm/index');
  return {
    ...actual,
    getProviderWithFallback: vi.fn(() => new MockLLMProvider('Mock Provider')),
    getLLMProvider: vi.fn(() => new MockLLMProvider('Mock Provider')),
  };
});

// Mock file operations
vi.mock('@/lib/discussions/file-manager', () => ({
  readDiscussion: vi.fn(),
  appendMessageToDiscussion: vi.fn(),
  addRoundToDiscussion: vi.fn(),
  addSummaryToDiscussion: vi.fn(),
}));

// Mock database
vi.mock('@/lib/db/discussions', () => ({
  createDiscussion: vi.fn(),
  getDiscussion: vi.fn(),
  updateDiscussion: vi.fn(),
}));

// Mock token counter
vi.mock('@/lib/discussions/token-counter', () => ({
  hasReachedThreshold: vi.fn((count: number, limit: number) => count >= limit),
  estimateTokenCount: vi.fn((text: string) => Math.ceil(text.length / 4)),
}));

describe('LLM Workflow Integration', () => {
  const discussionId = 'test-discussion';
  const userId = 'test-user';
  const topic = 'Test topic';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Complete Dialogue Round Workflow', () => {
    it('should process a complete dialogue round with resolution detection', async () => {
      const rounds = [
        createMockDiscussionRound(
          1,
          'The solution is to implement caching.',
          'I agree, that makes perfect sense.'
        ),
      ];

      // Convert rounds to messages for resolution detection
      const messages = [
        rounds[0].solverResponse,
        rounds[0].analyzerResponse,
        rounds[0].moderatorResponse,
      ];

      const resolved = isResolved(messages);
      expect(resolved.resolved).toBe(true);
    });

    it('should process multiple rounds and detect resolution', async () => {
      const rounds = createMultipleRounds(3);
      const lastRound = rounds[rounds.length - 1];

      // Add resolution keywords to last round
      lastRound.solverResponse.content = 'The solution is clear.';
      lastRound.analyzerResponse.content = 'I agree completely.';
      lastRound.moderatorResponse.content = 'This is the way forward.';

      const messages = [
        lastRound.solverResponse,
        lastRound.analyzerResponse,
        lastRound.moderatorResponse,
      ];

      const resolved = isResolved(messages);
      expect(resolved.resolved).toBe(true);
    });

    it('should detect user input needed during dialogue', () => {
      const rounds = [
        createMockDiscussionRound(
          1,
          'I need your input on this.',
          'Can you clarify your requirements?'
        ),
      ];

      const messages = [rounds[0].analyzerResponse];
      const inputNeeded = needsUserInput(messages);

      expect(inputNeeded.needsInput).toBe(true);
      expect(inputNeeded.question).toBeDefined();
    });
  });

  describe('Question Generation Workflow', () => {
    it('should generate questions after a round', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: JSON.stringify([
          {
            id: 'q1',
            text: 'Question 1?',
            options: [
              { id: 'o1-1', text: 'Option 1' },
              { id: 'o1-2', text: 'Option 2' },
            ],
          },
          {
            id: 'q2',
            text: 'Question 2?',
            options: [
              { id: 'o2-1', text: 'Option A' },
              { id: 'o2-2', text: 'Option B' },
            ],
          },
        ]),
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const currentRound = createMockDiscussionRound(1);
      const questionSet = await generateQuestions(discussionId, userId, topic, currentRound);

      expect(questionSet.questions).toHaveLength(2);
      expect(questionSet.roundNumber).toBe(1);
    });

    it('should include previous rounds in question context', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: JSON.stringify([
          {
            id: 'q1',
            text: 'Question?',
            options: [
              { id: 'o1-1', text: 'Option 1' },
              { id: 'o1-2', text: 'Option 2' },
            ],
          },
          {
            id: 'q2',
            text: 'Another question?',
            options: [
              { id: 'o2-1', text: 'Option A' },
              { id: 'o2-2', text: 'Option B' },
            ],
          },
        ]),
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const previousRounds = createMultipleRounds(2);
      const currentRound = createMockDiscussionRound(3);

      const questionSet = await generateQuestions(
        discussionId,
        userId,
        topic,
        currentRound,
        undefined,
        previousRounds
      );

      expect(questionSet.questions.length).toBeGreaterThanOrEqual(2);
      expect(getProviderWithFallback).toHaveBeenCalled();
    });
  });

  describe('Summarization Workflow', () => {
    it('should detect when summarization is needed', () => {
      const tokenCount = 5000;
      const tokenLimit = 4800;
      expect(shouldSummarize(tokenCount, tokenLimit)).toBe(true);
    });

    it('should generate comprehensive summary from rounds', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'This is a comprehensive summary of all rounds.',
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const rounds = createMultipleRounds(5);
      const summaryEntry = await generateComprehensiveSummary(
        discussionId,
        userId,
        topic,
        rounds,
        [],
        6
      );

      expect(summaryEntry.summary).toBe('This is a comprehensive summary of all rounds.');
      expect(summaryEntry.replacesRounds).toEqual([1, 2, 3, 4, 5]);
      expect(summaryEntry.tokenCountBefore).toBeGreaterThan(0);
      expect(summaryEntry.tokenCountAfter).toBeGreaterThan(0);
    });

    it('should include previous summaries in new summary context', async () => {
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: 'New summary including previous context.',
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const previousSummaries = [
        {
          summary: 'Previous summary',
          createdAt: Date.now() - 1000,
          roundNumber: 1,
          tokenCountBefore: 1000,
          tokenCountAfter: 500,
          replacesRounds: [1, 2],
        },
      ];

      const rounds = createMultipleRounds(3);
      const summaryEntry = await generateComprehensiveSummary(
        discussionId,
        userId,
        topic,
        rounds,
        previousSummaries,
        4
      );

      expect(summaryEntry.summary).toBeDefined();
      expect(getProviderWithFallback).toHaveBeenCalled();
    });
  });

  describe('End-to-End Workflow', () => {
    it('should handle complete workflow: rounds → resolution → summary', async () => {
      // Step 1: Create rounds
      const rounds = createMultipleRounds(3);

      // Step 2: Check resolution
      const lastRound = rounds[rounds.length - 1];
      lastRound.solverResponse.content = 'The solution is implemented.';
      lastRound.analyzerResponse.content = 'I agree, we can conclude.';
      lastRound.moderatorResponse.content = 'This is the final answer.';

      const messages = [
        lastRound.solverResponse,
        lastRound.analyzerResponse,
        lastRound.moderatorResponse,
      ];
      const resolved = isResolved(messages);
      expect(resolved.resolved).toBe(true);

      // Step 3: Generate summary if needed
      const tokenCount = 5000;
      const tokenLimit = 4800;
      if (shouldSummarize(tokenCount, tokenLimit)) {
        const mockProvider = new MockLLMProvider('Mock Provider', {
          responseText: 'Summary of all rounds.',
        });

        const { getProviderWithFallback } = await import('@/lib/llm/index');
        vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

        const summaryEntry = await generateComprehensiveSummary(
          discussionId,
          userId,
          topic,
          rounds,
          [],
          4
        );

        expect(summaryEntry.summary).toBeDefined();
      }
    });

    it('should handle workflow with user input needed', async () => {
      // Step 1: Create round that needs user input
      const round = createMockDiscussionRound(
        1,
        'I need your input.',
        'Can you clarify your requirements?'
      );

      // Step 2: Detect user input needed
      const messages = [round.analyzerResponse];
      const inputNeeded = needsUserInput(messages);
      expect(inputNeeded.needsInput).toBe(true);

      // Step 3: Generate questions to guide user
      const mockProvider = new MockLLMProvider('Mock Provider', {
        responseText: JSON.stringify([
          {
            id: 'q1',
            text: 'What are your requirements?',
            options: [
              { id: 'o1-1', text: 'Option 1' },
              { id: 'o1-2', text: 'Option 2' },
            ],
          },
          {
            id: 'q2',
            text: 'What is your priority?',
            options: [
              { id: 'o2-1', text: 'Performance' },
              { id: 'o2-2', text: 'Cost' },
            ],
          },
        ]),
      });

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

      const questionSet = await generateQuestions(discussionId, userId, topic, round);

      expect(questionSet.questions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Error Handling in Workflow', () => {
    it('should handle provider errors gracefully', async () => {
      const errorProvider = MockLLMProvider.createErrorProvider('Error Provider', 'Provider error');

      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(errorProvider as any);

      const currentRound = createMockDiscussionRound(1);

      await expect(generateQuestions(discussionId, userId, topic, currentRound)).rejects.toThrow();
    });

    it('should handle empty responses', async () => {
      const emptyProvider = MockLLMProvider.createEmptyProvider();
      const { getProviderWithFallback } = await import('@/lib/llm/index');
      vi.mocked(getProviderWithFallback).mockReturnValue(emptyProvider as any);

      const rounds = createMultipleRounds(2);

      await expect(
        generateComprehensiveSummary(discussionId, userId, topic, rounds, [], 3)
      ).rejects.toThrow('empty response');
    });
  });
});
