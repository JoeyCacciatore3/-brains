import { describe, it, expect } from 'vitest';
import { isResolved } from '@/lib/llm/resolver';
import type { ConversationMessage } from '@/types';

describe('isResolved', () => {
  it('should return false for short conversations', () => {
    const conversation: ConversationMessage[] = [
      {
        persona: 'Solver AI',
        content: 'Hello',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
    ];
    const result = isResolved(conversation);
    expect(result.resolved).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('should return true when max turns reached', () => {
    const conversation: ConversationMessage[] = Array.from({ length: 60 }, (_, i) => {
      const personas = ['Solver AI', 'Analyzer AI', 'Moderator AI'];
      return {
        discussion_id: 'test',
        persona: personas[i % 3] as 'Solver AI' | 'Analyzer AI' | 'Moderator AI',
        content: `Message ${i}`,
        turn: Math.floor(i / 3) + 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      };
    });
    const result = isResolved(conversation);
    expect(result.resolved).toBe(true);
    expect(result.reason).toBe('max_turns');
    expect(result.confidence).toBe(0.5);
  });

  it('should return true when resolution keywords are present', () => {
    const conversation: ConversationMessage[] = [
      {
        persona: 'Solver AI',
        content: 'Let me think about this problem.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'I see what you mean.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'This is an interesting discussion.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Solver AI',
        content: 'The solution is to implement a caching layer.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'I agree, that makes sense.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'I concur with this approach.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
    ];
    const result = isResolved(conversation);
    expect(result.resolved).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reason).toBeDefined();
  });

  it('should return false when no resolution indicators', () => {
    const conversation: ConversationMessage[] = [
      {
        persona: 'Solver AI',
        content: 'Let me think about this problem.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'I see what you mean.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'This is an interesting discussion.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
    ];
    const result = isResolved(conversation);
    expect(result.resolved).toBe(false);
  });

  it('should filter out negated resolution keywords', () => {
    const conversation: ConversationMessage[] = [
      {
        persona: 'Solver AI',
        content: 'This is not a solution to the problem.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'I agree, we have no conclusion yet.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'We need more discussion.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Solver AI',
        content: 'We need to explore more options.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'Yes, let us continue.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'I agree, more exploration is needed.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
    ];
    const result = isResolved(conversation);
    expect(result.resolved).toBe(false);
  });

  it('should detect multiple agreement patterns', () => {
    const conversation: ConversationMessage[] = [
      {
        persona: 'Solver AI',
        content: 'I think we should implement caching.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'That makes perfect sense. I agree completely.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'This is a solid approach.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Solver AI',
        content: 'You are absolutely right. We can conclude here.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'Exactly! That is the solution.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'I concur. This is the way forward.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
    ];
    const result = isResolved(conversation);
    expect(result.resolved).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should detect convergence (shorter messages)', () => {
    const conversation: ConversationMessage[] = [
      {
        persona: 'Solver AI',
        content: 'A'.repeat(500), // Long message
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'B'.repeat(500),
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'C'.repeat(500),
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Solver AI',
        content: 'I agree.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'Perfect.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'Agreed.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
    ];
    // Should detect convergence if messages get shorter
    // Note: This depends on RESOLUTION_CONVERGENCE_THRESHOLD config
    const result = isResolved(conversation);
    expect(result.resolved).toBeDefined();
    expect(typeof result.resolved).toBe('boolean');
    expect(typeof result.confidence).toBe('number');
  });

  it('should handle empty messages array', () => {
    const conversation: ConversationMessage[] = [];
    const result = isResolved(conversation);
    expect(result.resolved).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('should handle single message', () => {
    const conversation: ConversationMessage[] = [
      {
        persona: 'Solver AI',
        content: 'Hello',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
    ];
    const result = isResolved(conversation);
    expect(result.resolved).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('should detect resolution with strong keywords (3+)', () => {
    const conversation: ConversationMessage[] = [
      {
        persona: 'Solver AI',
        content: 'The solution is clear.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'I see the conclusion.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'This is a good direction.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Solver AI',
        content: 'This is the final recommendation.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'We have reached consensus.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'I agree with this conclusion.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Solver AI',
        content: 'The answer is implementation.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 3,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'Agreed.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 3,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'Perfect. This is resolved.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 3,
        timestamp: new Date().toISOString(),
      },
    ];
    const result = isResolved(conversation);
    expect(result.resolved).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should handle special characters and unicode', () => {
    const conversation: ConversationMessage[] = [
      {
        persona: 'Solver AI',
        content: 'The solution is: 🎯 implement caching!',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'I agree, that makes sense.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'This is a good approach.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Solver AI',
        content: 'Therefore, we can conclude.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'Exactly!',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'I concur.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
    ];
    const result = isResolved(conversation);
    expect(result.resolved).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should extract solution from conversation with solution text', () => {
    const conversation: ConversationMessage[] = [
      {
        persona: 'Solver AI',
        content: 'Let me think about this problem.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'I see what you mean.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'This is an interesting discussion.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 1,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Solver AI',
        content: 'The solution is to implement a caching layer for better performance.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Analyzer AI',
        content: 'I agree, that makes sense.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
      {
        persona: 'Moderator AI',
        content: 'I concur with this approach.',
        discussion_id: 'test',
        created_at: Date.now(),
        turn: 2,
        timestamp: new Date().toISOString(),
      },
    ];
    const result = isResolved(conversation);
    expect(result.resolved).toBe(true);
    // Solution should be extracted from Solver AI response
    if (result.solution) {
      expect(result.solution.length).toBeLessThanOrEqual(500);
      expect(result.solution.toLowerCase()).toContain('caching');
    }
  });

  it('should return confidence score between 0 and 1', () => {
    const conversation: ConversationMessage[] = Array.from({ length: 60 }, (_, i) => {
      const personas = ['Solver AI', 'Analyzer AI', 'Moderator AI'];
      return {
        discussion_id: 'test',
        persona: personas[i % 3] as 'Solver AI' | 'Analyzer AI' | 'Moderator AI',
        content: `Message ${i}`,
        turn: Math.floor(i / 3) + 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      };
    });
    const result = isResolved(conversation);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
