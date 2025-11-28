import { describe, it, expect, beforeEach } from 'vitest';
import { calculateDiscussionTokenCount } from '@/lib/discussions/token-counter';
import { createMockDiscussionRound, createMockSummaryEntry } from '@/tests/utils/test-fixtures';

describe('calculateDiscussionTokenCount', () => {
  describe('without overhead (content only)', () => {
    it('should calculate token count for rounds without overhead', () => {
      const discussionData = {
        rounds: [
          createMockDiscussionRound(1, 'Solver content', 'Analyzer content', 'Moderator content'),
          createMockDiscussionRound(2, 'Solver content 2', 'Analyzer content 2', 'Moderator content 2'),
        ],
      };

      const tokenCount = calculateDiscussionTokenCount(discussionData, {
        includeSystemPrompts: false,
        includeFormattingOverhead: false,
      });

      expect(tokenCount).toBeGreaterThan(0);
      // Should only count content tokens
      expect(typeof tokenCount).toBe('number');
    });

    it('should calculate token count with summary (no overhead)', () => {
      const discussionData = {
        rounds: [
          createMockDiscussionRound(3, 'Solver', 'Analyzer', 'Moderator'),
        ],
        currentSummary: createMockSummaryEntry('Summary text', 2, [1, 2]),
      };

      const tokenCount = calculateDiscussionTokenCount(discussionData, {
        includeSystemPrompts: false,
        includeFormattingOverhead: false,
      });

      expect(tokenCount).toBeGreaterThan(0);
      // Should include summary tokens + rounds after summary tokens
      expect(typeof tokenCount).toBe('number');
    });
  });

  describe('with overhead (full context)', () => {
    it('should calculate token count with system prompts and formatting overhead', () => {
      const discussionData = {
        rounds: [
          createMockDiscussionRound(1, 'Solver content', 'Analyzer content', 'Moderator content'),
        ],
      };

      const tokenCount = calculateDiscussionTokenCount(discussionData, {
        includeSystemPrompts: true,
        includeFormattingOverhead: true,
      });

      expect(tokenCount).toBeGreaterThan(0);
      // Should be larger than content-only count
      const contentOnlyCount = calculateDiscussionTokenCount(discussionData, {
        includeSystemPrompts: false,
        includeFormattingOverhead: false,
      });
      expect(tokenCount).toBeGreaterThan(contentOnlyCount);
    });

    it('should calculate token count with summary including overhead', () => {
      const discussionData = {
        rounds: [
          createMockDiscussionRound(3, 'Solver', 'Analyzer', 'Moderator'),
        ],
        currentSummary: createMockSummaryEntry('Summary text', 2, [1, 2]),
      };

      const tokenCount = calculateDiscussionTokenCount(discussionData, {
        includeSystemPrompts: true,
        includeFormattingOverhead: true,
      });

      expect(tokenCount).toBeGreaterThan(0);
      // Should include summary + system prompts + formatting + rounds after summary
      expect(typeof tokenCount).toBe('number');
    });
  });

  describe('default options (include overhead)', () => {
    it('should default to including overhead when options not specified', () => {
      const discussionData = {
        rounds: [
          createMockDiscussionRound(1, 'Solver', 'Analyzer', 'Moderator'),
        ],
      };

      const tokenCountWithDefaults = calculateDiscussionTokenCount(discussionData);
      const tokenCountWithOverhead = calculateDiscussionTokenCount(discussionData, {
        includeSystemPrompts: true,
        includeFormattingOverhead: true,
      });

      expect(tokenCountWithDefaults).toBe(tokenCountWithOverhead);
      expect(tokenCountWithDefaults).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should return 0 for empty discussion', () => {
      const discussionData = {
        rounds: [],
      };

      const tokenCount = calculateDiscussionTokenCount(discussionData);
      expect(tokenCount).toBe(0);
    });

    it('should handle legacy messages array', () => {
      const discussionData = {
        messages: [
          {
            content: 'Legacy message 1',
            persona: 'User',
            turn: 1,
            timestamp: new Date().toISOString(),
            created_at: Date.now(),
          },
          {
            content: 'Legacy message 2',
            persona: 'Solver AI',
            turn: 2,
            timestamp: new Date().toISOString(),
            created_at: Date.now(),
          },
        ],
      };

      const tokenCount = calculateDiscussionTokenCount(discussionData);
      expect(tokenCount).toBeGreaterThan(0);
    });
  });
});
