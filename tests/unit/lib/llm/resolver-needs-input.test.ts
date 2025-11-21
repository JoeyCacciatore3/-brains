import { describe, it, expect } from 'vitest';
import { needsUserInput } from '@/lib/llm/resolver';
import type { ConversationMessage } from '@/types';

describe('needsUserInput', () => {
  it('should return false for empty conversation', () => {
    const messages: ConversationMessage[] = [];
    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(false);
  });

  it('should detect questions with question marks', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'Solver AI',
        content: 'What do you think about this approach?',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(true);
    expect(result.question).toBeDefined();
  });

  it('should detect explicit requests for input', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'Analyzer AI',
        content: 'I need more information to proceed. Can you provide details?',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(true);
  });

  it('should not detect user input needed for user messages', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'User',
        content: 'This is my input',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(false);
  });

  it('should extract question text when available', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'Solver AI',
        content:
          'To better understand your requirements, could you clarify what you mean by "scalability"?',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(true);
    expect(result.question).toBeDefined();
    expect(result.question?.length).toBeGreaterThan(0);
  });

  it('should filter out rhetorical questions', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'Solver AI',
        content: 'What if we tried a different approach?',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(false);
  });

  it('should filter out AI-to-AI questions', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'Analyzer AI',
        content: 'What do you think about this?',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
      {
        discussion_id: 'test',
        persona: 'Solver AI',
        content: 'What is your take on this approach?',
        turn: 2,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    // Should not detect as user input needed since previous message is from AI
    expect(result.needsInput).toBe(false);
  });

  it('should detect explicit user-directed requests', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'Solver AI',
        content: 'I need your input on this matter. What are your preferences?',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(true);
    expect(result.question).toBeDefined();
  });

  it('should detect questions with user context', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'Analyzer AI',
        content: 'Could you help me understand your requirements?',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(true);
  });

  it('should detect "please provide" patterns', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'Solver AI',
        content: 'Please provide more information about your use case.',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(true);
  });

  it('should detect "what are your thoughts" patterns', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'Analyzer AI',
        content: 'What are your thoughts on this approach?',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(true);
  });

  it('should handle questions without question marks but with user context', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'Solver AI',
        content: 'I need your feedback to proceed.',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(true);
  });

  it('should extract question with context from long message', () => {
    const longMessage =
      'This is a long message with some context. '.repeat(10) +
      'To better understand your requirements, could you clarify what you mean by "scalability"? ' +
      'This is more context after the question. '.repeat(10);

    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'Solver AI',
        content: longMessage,
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(true);
    expect(result.question).toBeDefined();
    expect(result.question?.length).toBeGreaterThan(0);
    expect(result.question).toContain('scalability');
  });

  it('should handle messages with special characters', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'Solver AI',
        content: 'Could you clarify what you mean by "scalability" (performance)?',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(true);
  });

  it('should not detect user input when previous message is from user', () => {
    const messages: ConversationMessage[] = [
      {
        discussion_id: 'test',
        persona: 'User',
        content: 'I need help with this.',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
      {
        discussion_id: 'test',
        persona: 'Solver AI',
        content: 'I understand. Let me help you.',
        turn: 2,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
    ];

    const result = needsUserInput(messages);
    expect(result.needsInput).toBe(false);
  });
});
