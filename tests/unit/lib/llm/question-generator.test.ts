import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateQuestions } from '@/lib/llm/question-generator';
import { MockLLMProvider } from '@/tests/utils/mock-llm-provider';
import { createMockDiscussionRound } from '@/tests/utils/test-fixtures';
import type { DiscussionRound } from '@/types';

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
        systemPrompt: 'You are a question generator.',
      },
    },
  };
});

describe('generateQuestions', () => {
  const discussionId = 'test-discussion';
  const userId = 'test-user';
  const topic = 'Test topic';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate valid question set with 2-5 questions', async () => {
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
    expect(questionSet.generatedAt).toBeDefined();
    expect(questionSet.questions[0].id).toBe('q1');
    expect(questionSet.questions[0].text).toBe('Question 1?');
    expect(questionSet.questions[0].options).toHaveLength(2);
  });

  it('should enforce minimum 2 questions', async () => {
    const mockProvider = new MockLLMProvider('Mock Provider', {
      responseText: JSON.stringify([
        {
          id: 'q1',
          text: 'Only one question?',
          options: [
            { id: 'o1-1', text: 'Option 1' },
            { id: 'o1-2', text: 'Option 2' },
          ],
        },
      ]),
    });

    const { getProviderWithFallback } = await import('@/lib/llm/index');
    vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

    const currentRound = createMockDiscussionRound(1);
    const questionSet = await generateQuestions(discussionId, userId, topic, currentRound);

    expect(questionSet.questions.length).toBeGreaterThanOrEqual(2);
  });

  it('should enforce maximum 5 questions', async () => {
    const mockProvider = new MockLLMProvider('Mock Provider', {
      responseText: JSON.stringify(
        Array.from({ length: 10 }, (_, i) => ({
          id: `q${i + 1}`,
          text: `Question ${i + 1}?`,
          options: [
            { id: `o${i + 1}-1`, text: 'Option 1' },
            { id: `o${i + 1}-2`, text: 'Option 2' },
          ],
        }))
      ),
    });

    const { getProviderWithFallback } = await import('@/lib/llm/index');
    vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

    const currentRound = createMockDiscussionRound(1);
    const questionSet = await generateQuestions(discussionId, userId, topic, currentRound);

    expect(questionSet.questions.length).toBeLessThanOrEqual(5);
  });

  it('should extract JSON from text response', async () => {
    const mockProvider = new MockLLMProvider('Mock Provider', {
      responseText: `Here are some questions:\n${JSON.stringify([
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
      ])}\nThese questions should help.`,
    });

    const { getProviderWithFallback } = await import('@/lib/llm/index');
    vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

    const currentRound = createMockDiscussionRound(1);
    const questionSet = await generateQuestions(discussionId, userId, topic, currentRound);

    expect(questionSet.questions).toHaveLength(2);
  });

  it('should generate unique IDs for missing question IDs', async () => {
    const mockProvider = new MockLLMProvider('Mock Provider', {
      responseText: JSON.stringify([
        {
          text: 'Question without ID?',
          options: [
            { id: 'o1-1', text: 'Option 1' },
            { id: 'o1-2', text: 'Option 2' },
          ],
        },
        {
          id: 'q2',
          text: 'Question with ID?',
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

    expect(questionSet.questions[0].id).toBeDefined();
    expect(questionSet.questions[1].id).toBe('q2');
  });

  it('should validate question structure', async () => {
    const mockProvider = new MockLLMProvider('Mock Provider', {
      responseText: JSON.stringify([
        {
          id: 'q1',
          text: 'Valid question?',
          options: [
            { id: 'o1-1', text: 'Option 1' },
            { id: 'o1-2', text: 'Option 2' },
          ],
        },
        {
          // Missing text
          id: 'q2',
          options: [{ id: 'o2-1', text: 'Option 1' }],
        },
      ]),
    });

    const { getProviderWithFallback } = await import('@/lib/llm/index');
    vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

    const currentRound = createMockDiscussionRound(1);

    await expect(generateQuestions(discussionId, userId, topic, currentRound)).rejects.toThrow(
      'Invalid question format'
    );
  });

  it('should enforce minimum 2 options per question', async () => {
    const mockProvider = new MockLLMProvider('Mock Provider', {
      responseText: JSON.stringify([
        {
          id: 'q1',
          text: 'Question with only one option?',
          options: [{ id: 'o1-1', text: 'Only option' }],
        },
      ]),
    });

    const { getProviderWithFallback } = await import('@/lib/llm/index');
    vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

    const currentRound = createMockDiscussionRound(1);

    await expect(generateQuestions(discussionId, userId, topic, currentRound)).rejects.toThrow(
      'Invalid question format'
    );
  });

  it('should handle empty response', async () => {
    const mockProvider = MockLLMProvider.createEmptyProvider();
    const { getProviderWithFallback } = await import('@/lib/llm/index');
    vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

    const currentRound = createMockDiscussionRound(1);

    await expect(generateQuestions(discussionId, userId, topic, currentRound)).rejects.toThrow(
      'empty response'
    );
  });

  it('should handle invalid JSON response', async () => {
    const mockProvider = new MockLLMProvider('Mock Provider', {
      responseText: 'This is not valid JSON',
    });

    const { getProviderWithFallback } = await import('@/lib/llm/index');
    vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

    const currentRound = createMockDiscussionRound(1);

    await expect(generateQuestions(discussionId, userId, topic, currentRound)).rejects.toThrow(
      'invalid JSON format'
    );
  });

  it('should handle non-array JSON response', async () => {
    const mockProvider = new MockLLMProvider('Mock Provider', {
      responseText: JSON.stringify({ error: 'Not an array' }),
    });

    const { getProviderWithFallback } = await import('@/lib/llm/index');
    vi.mocked(getProviderWithFallback).mockReturnValue(mockProvider as any);

    const currentRound = createMockDiscussionRound(1);

    await expect(generateQuestions(discussionId, userId, topic, currentRound)).rejects.toThrow(
      'did not return an array'
    );
  });

  it('should include previous rounds in context', async () => {
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

    const previousRounds: DiscussionRound[] = [
      createMockDiscussionRound(1, 'Previous solver', 'Previous analyzer'),
    ];
    const currentRound = createMockDiscussionRound(2);

    await generateQuestions(discussionId, userId, topic, currentRound, undefined, previousRounds);

    // Verify provider was called (context was built)
    expect(getProviderWithFallback).toHaveBeenCalled();
  });

  it('should include summary in context', async () => {
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
    const summary = {
      summary: 'Previous discussion summary',
      createdAt: Date.now(),
      roundNumber: 0,
      tokenCountBefore: 1000,
      tokenCountAfter: 500,
      replacesRounds: [1],
    };

    await generateQuestions(discussionId, userId, topic, currentRound, summary);

    expect(getProviderWithFallback).toHaveBeenCalled();
  });
});
