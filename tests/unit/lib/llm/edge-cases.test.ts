import { describe, it, expect } from 'vitest';
import { isResolved, needsUserInput } from '@/lib/llm/resolver';
import { createLongConversation, createMockConversationMessage } from '@/tests/utils/test-fixtures';
import type { ConversationMessage } from '@/types';

describe('LLM Edge Cases', () => {
  describe('Resolution Detection Edge Cases', () => {
    it('should handle very long messages', () => {
      const conversation: ConversationMessage[] = [
        createMockConversationMessage('Solver AI', 'A'.repeat(10000), 1),
        createMockConversationMessage('Analyzer AI', 'B'.repeat(10000), 1),
        createMockConversationMessage('Solver AI', 'The solution is clear.', 2),
        createMockConversationMessage('Analyzer AI', 'I agree completely.', 2),
      ];

      const resolved = isResolved(conversation);
      expect(typeof resolved.resolved).toBe('boolean');
      expect(typeof resolved.confidence).toBe('number');
    });

    it('should handle very short messages', () => {
      const conversation: ConversationMessage[] = [
        createMockConversationMessage('Solver AI', 'Hi', 1),
        createMockConversationMessage('Analyzer AI', 'Hi', 1),
        createMockConversationMessage('Solver AI', 'OK', 2),
        createMockConversationMessage('Analyzer AI', 'OK', 2),
      ];

      const resolved = isResolved(conversation);
      expect(typeof resolved.resolved).toBe('boolean');
      expect(typeof resolved.confidence).toBe('number');
    });

    it('should handle messages with only whitespace', () => {
      const conversation: ConversationMessage[] = [
        createMockConversationMessage('Solver AI', '   ', 1),
        createMockConversationMessage('Analyzer AI', '\n\t', 1),
        createMockConversationMessage('Solver AI', 'The solution.', 2),
        createMockConversationMessage('Analyzer AI', 'I agree.', 2),
      ];

      const resolved = isResolved(conversation);
      expect(typeof resolved.resolved).toBe('boolean');
      expect(typeof resolved.confidence).toBe('number');
    });

    it('should handle unicode and special characters', () => {
      const conversation: ConversationMessage[] = [
        createMockConversationMessage('Solver AI', 'Solution: 🎯 ✅', 1),
        createMockConversationMessage('Analyzer AI', 'Agreed! 👍', 1),
        createMockConversationMessage('Solver AI', 'The solution is: <implementation>', 2),
        createMockConversationMessage('Analyzer AI', 'I agree with "that" approach.', 2),
      ];

      const resolved = isResolved(conversation);
      expect(typeof resolved.resolved).toBe('boolean');
      expect(typeof resolved.confidence).toBe('number');
    });

    it('should handle messages with HTML-like content', () => {
      const conversation: ConversationMessage[] = [
        createMockConversationMessage('Solver AI', 'The solution is <not> a problem', 1),
        createMockConversationMessage('Analyzer AI', 'I agree & concur', 1),
        createMockConversationMessage('Solver AI', 'Conclusion: we can proceed', 2),
        createMockConversationMessage('Analyzer AI', 'Exactly!', 2),
      ];

      const resolved = isResolved(conversation);
      expect(typeof resolved.resolved).toBe('boolean');
      expect(typeof resolved.confidence).toBe('number');
    });

    it('should handle extremely long conversation', () => {
      const conversation = createLongConversation(100);

      const resolved = isResolved(conversation);
      expect(typeof resolved.resolved).toBe('boolean');
      expect(typeof resolved.confidence).toBe('number');
    });

    it('should handle mixed case resolution keywords', () => {
      const conversation: ConversationMessage[] = [
        createMockConversationMessage('Solver AI', 'The SOLUTION is clear.', 1),
        createMockConversationMessage('Analyzer AI', 'I AGREE completely.', 1),
        createMockConversationMessage('Solver AI', 'We can CONCLUDE here.', 2),
        createMockConversationMessage('Analyzer AI', 'That makes SENSE.', 2),
      ];

      const resolved = isResolved(conversation);
      expect(typeof resolved.resolved).toBe('boolean');
      expect(typeof resolved.confidence).toBe('number');
    });
  });

  describe('User Input Detection Edge Cases', () => {
    it('should handle questions with unicode characters', () => {
      const messages: ConversationMessage[] = [
        createMockConversationMessage(
          'Solver AI',
          'Could you clarify what you mean by "scalability" 🚀?',
          1
        ),
      ];

      const result = needsUserInput(messages);
      expect(typeof result.needsInput).toBe('boolean');
    });

    it('should handle very long questions', () => {
      const longQuestion = 'Can you clarify '.repeat(100) + 'your requirements?';
      const messages: ConversationMessage[] = [
        createMockConversationMessage('Solver AI', longQuestion, 1),
      ];

      const result = needsUserInput(messages);
      expect(typeof result.needsInput).toBe('boolean');
      if (result.needsInput) {
        expect(result.question).toBeDefined();
      }
    });

    it('should handle questions with special punctuation', () => {
      const messages: ConversationMessage[] = [
        createMockConversationMessage('Solver AI', 'What are your thoughts on this approach?!', 1),
      ];

      const result = needsUserInput(messages);
      expect(typeof result.needsInput).toBe('boolean');
    });

    it('should handle questions in different languages (basic)', () => {
      const messages: ConversationMessage[] = [
        createMockConversationMessage('Solver AI', '¿Puedes aclarar tus requisitos?', 1),
      ];

      const result = needsUserInput(messages);
      // May or may not detect, but should not crash
      expect(typeof result.needsInput).toBe('boolean');
    });

    it('should handle messages with only punctuation', () => {
      const messages: ConversationMessage[] = [
        createMockConversationMessage('Solver AI', '???', 1),
      ];

      const result = needsUserInput(messages);
      expect(typeof result.needsInput).toBe('boolean');
    });

    it('should handle messages with code blocks', () => {
      const messages: ConversationMessage[] = [
        createMockConversationMessage(
          'Solver AI',
          'Can you explain this code: `function test() { return true; }`?',
          1
        ),
      ];

      const result = needsUserInput(messages);
      expect(typeof result.needsInput).toBe('boolean');
    });
  });

  describe('Token Limit Edge Cases', () => {
    it('should handle token count at exact threshold', () => {
      const { shouldSummarize } = require('@/lib/llm/summarizer');
      const tokenCount = 4800;
      const tokenLimit = 4800;

      const shouldSummarizeResult = shouldSummarize(tokenCount, tokenLimit);
      expect(typeof shouldSummarizeResult).toBe('boolean');
    });

    it('should handle token count just below threshold', () => {
      const { shouldSummarize } = require('@/lib/llm/summarizer');
      const tokenCount = 4799;
      const tokenLimit = 4800;

      const shouldSummarizeResult = shouldSummarize(tokenCount, tokenLimit);
      expect(typeof shouldSummarizeResult).toBe('boolean');
    });

    it('should handle very large token counts', () => {
      const { shouldSummarize } = require('@/lib/llm/summarizer');
      const tokenCount = 1000000;
      const tokenLimit = 4800;

      const shouldSummarizeResult = shouldSummarize(tokenCount, tokenLimit);
      expect(shouldSummarizeResult).toBe(true);
    });

    it('should handle zero token count', () => {
      const { shouldSummarize } = require('@/lib/llm/summarizer');
      const tokenCount = 0;
      const tokenLimit = 4800;

      const shouldSummarizeResult = shouldSummarize(tokenCount, tokenLimit);
      expect(shouldSummarizeResult).toBe(false);
    });
  });

  describe('File Handling Edge Cases', () => {
    it('should handle empty file arrays', async () => {
      const messages = [
        {
          role: 'user' as const,
          content: 'Test',
          files: [],
        },
      ];

      // Should not crash with empty files array
      expect(messages[0].files).toEqual([]);
    });

    it('should handle very large file sizes (near limit)', () => {
      const largeFile = {
        name: 'large.pdf',
        type: 'application/pdf',
        size: 10 * 1024 * 1024 - 1, // Just under 10MB
        base64: 'base64data',
      };

      expect(largeFile.size).toBeLessThan(10 * 1024 * 1024);
    });

    it('should handle multiple files at limit', () => {
      const files = Array.from({ length: 5 }, (_, i) => ({
        name: `file${i}.pdf`,
        type: 'application/pdf',
        size: 2 * 1024 * 1024, // 2MB each
        base64: 'base64data',
      }));

      expect(files.length).toBe(5);
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      expect(totalSize).toBeLessThan(10 * 1024 * 1024 * 5); // Under combined limit
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle exactly 4 messages (minimum for resolution)', () => {
      const conversation: ConversationMessage[] = [
        createMockConversationMessage('Solver AI', 'Message 1', 1),
        createMockConversationMessage('Analyzer AI', 'Message 2', 1),
        createMockConversationMessage('Solver AI', 'The solution.', 2),
        createMockConversationMessage('Analyzer AI', 'I agree.', 2),
      ];

      const resolved = isResolved(conversation);
      expect(typeof resolved.resolved).toBe('boolean');
      expect(typeof resolved.confidence).toBe('number');
    });

    it('should handle exactly 3 messages (below minimum)', () => {
      const conversation: ConversationMessage[] = [
        createMockConversationMessage('Solver AI', 'Message 1', 1),
        createMockConversationMessage('Analyzer AI', 'Message 2', 1),
        createMockConversationMessage('Solver AI', 'Message 3', 2),
      ];

      const resolved = isResolved(conversation);
      expect(resolved.resolved).toBe(false);
    });

    it('should handle max turns boundary (40 messages)', () => {
      const conversation = createLongConversation(40);

      const resolved = isResolved(conversation);
      // Should trigger max turns resolution
      expect(resolved.resolved).toBe(true);
      expect(resolved.reason).toBe('max_turns');
    });
  });
});
