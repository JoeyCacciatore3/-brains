import { describe, it, expect, beforeEach, vi } from 'vitest';
import { calculateTurnNumber } from '@/lib/discussions/round-utils';
import { validatePersonaOrder } from '@/lib/discussions/round-validator';
import { validateTurnNumbers, validateRoundCompleteness } from '@/lib/discussions/round-validator';
import type { DiscussionRound, ConversationMessage } from '@/types';

describe('Turn Order and Chunk Flow Integration Tests', () => {
  describe('Turn Number Calculation', () => {
    it('should calculate correct turn numbers for Round 1', () => {
      expect(calculateTurnNumber(1, 'Analyzer AI')).toBe(1);
      expect(calculateTurnNumber(1, 'Solver AI')).toBe(2);
      expect(calculateTurnNumber(1, 'Moderator AI')).toBe(3);
    });

    it('should calculate correct turn numbers for Round 2', () => {
      expect(calculateTurnNumber(2, 'Analyzer AI')).toBe(4);
      expect(calculateTurnNumber(2, 'Solver AI')).toBe(5);
      expect(calculateTurnNumber(2, 'Moderator AI')).toBe(6);
    });

    it('should calculate correct turn numbers for Round 3', () => {
      expect(calculateTurnNumber(3, 'Analyzer AI')).toBe(7);
      expect(calculateTurnNumber(3, 'Solver AI')).toBe(8);
      expect(calculateTurnNumber(3, 'Moderator AI')).toBe(9);
    });
  });

  describe('Persona Order Validation', () => {
    it('should validate first message must be Analyzer AI', () => {
      const result = validatePersonaOrder('Analyzer AI', null, true);
      expect(result.isValid).toBe(true);
    });

    it('should reject first message if not Analyzer AI', () => {
      const result = validatePersonaOrder('Solver AI', null, true);
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('Analyzer AI');
    });

    it('should validate correct order: Analyzer → Solver', () => {
      const result = validatePersonaOrder('Solver AI', 'Analyzer AI', false);
      expect(result.isValid).toBe(true);
    });

    it('should validate correct order: Solver → Moderator', () => {
      const result = validatePersonaOrder('Moderator AI', 'Solver AI', false);
      expect(result.isValid).toBe(true);
    });

    it('should validate correct order: Moderator → Analyzer (new round)', () => {
      const result = validatePersonaOrder('Analyzer AI', 'Moderator AI', false);
      expect(result.isValid).toBe(true);
    });

    it('should reject incorrect order: Analyzer → Moderator', () => {
      const result = validatePersonaOrder('Moderator AI', 'Analyzer AI', false);
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('Solver AI');
    });

    it('should reject incorrect order: Solver → Analyzer', () => {
      const result = validatePersonaOrder('Analyzer AI', 'Solver AI', false);
      expect(result.isValid).toBe(false);
    });
  });

  describe('Turn Number Validation in Rounds', () => {
    it('should validate correct turn numbers in a round', () => {
      const round: DiscussionRound = {
        roundNumber: 1,
        analyzerResponse: {
          discussion_id: 'test',
          persona: 'Analyzer AI',
          content: 'Test',
          turn: 1,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        solverResponse: {
          discussion_id: 'test',
          persona: 'Solver AI',
          content: 'Test',
          turn: 2,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        moderatorResponse: {
          discussion_id: 'test',
          persona: 'Moderator AI',
          content: 'Test',
          turn: 3,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        timestamp: new Date().toISOString(),
      };

      const result = validateTurnNumbers(round, {
        analyzer: 1,
        solver: 2,
        moderator: 3,
      });

      expect(result.isValid).toBe(true);
    });

    it('should reject incorrect turn numbers', () => {
      const round: DiscussionRound = {
        roundNumber: 1,
        analyzerResponse: {
          discussion_id: 'test',
          persona: 'Analyzer AI',
          content: 'Test',
          turn: 2, // Wrong - should be 1
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        solverResponse: {
          discussion_id: 'test',
          persona: 'Solver AI',
          content: 'Test',
          turn: 2,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        moderatorResponse: {
          discussion_id: 'test',
          persona: 'Moderator AI',
          content: 'Test',
          turn: 3,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        timestamp: new Date().toISOString(),
      };

      const result = validateTurnNumbers(round, {
        analyzer: 1,
        solver: 2,
        moderator: 3,
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some((e) => e.includes('Analyzer'))).toBe(true);
    });
  });

  describe('Round Completeness Validation', () => {
    it('should validate complete round', () => {
      const round: DiscussionRound = {
        roundNumber: 1,
        analyzerResponse: {
          discussion_id: 'test',
          persona: 'Analyzer AI',
          content: 'Analyzer response',
          turn: 1,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        solverResponse: {
          discussion_id: 'test',
          persona: 'Solver AI',
          content: 'Solver response',
          turn: 2,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        moderatorResponse: {
          discussion_id: 'test',
          persona: 'Moderator AI',
          content: 'Moderator response',
          turn: 3,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        timestamp: new Date().toISOString(),
      };

      const result = validateRoundCompleteness(round);
      expect(result.isValid).toBe(true);
    });

    it('should reject incomplete round (missing content)', () => {
      const round: DiscussionRound = {
        roundNumber: 1,
        analyzerResponse: {
          discussion_id: 'test',
          persona: 'Analyzer AI',
          content: 'Analyzer response',
          turn: 1,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        solverResponse: {
          discussion_id: 'test',
          persona: 'Solver AI',
          content: '', // Empty
          turn: 2,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        moderatorResponse: {
          discussion_id: 'test',
          persona: 'Moderator AI',
          content: 'Moderator response',
          turn: 3,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        timestamp: new Date().toISOString(),
      };

      const result = validateRoundCompleteness(round);
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some((e) => e.includes('Solver'))).toBe(true);
    });
  });

  describe('Multi-Round Turn Order', () => {
    it('should validate turn order across multiple rounds', () => {
      const rounds: DiscussionRound[] = [
        {
          roundNumber: 1,
          analyzerResponse: {
            discussion_id: 'test',
            persona: 'Analyzer AI',
            content: 'Round 1 Analyzer',
            turn: 1,
            timestamp: new Date().toISOString(),
            created_at: Date.now(),
          },
          solverResponse: {
            discussion_id: 'test',
            persona: 'Solver AI',
            content: 'Round 1 Solver',
            turn: 2,
            timestamp: new Date().toISOString(),
            created_at: Date.now(),
          },
          moderatorResponse: {
            discussion_id: 'test',
            persona: 'Moderator AI',
            content: 'Round 1 Moderator',
            turn: 3,
            timestamp: new Date().toISOString(),
            created_at: Date.now(),
          },
          timestamp: new Date().toISOString(),
        },
        {
          roundNumber: 2,
          analyzerResponse: {
            discussion_id: 'test',
            persona: 'Analyzer AI',
            content: 'Round 2 Analyzer',
            turn: 4,
            timestamp: new Date().toISOString(),
            created_at: Date.now(),
          },
          solverResponse: {
            discussion_id: 'test',
            persona: 'Solver AI',
            content: 'Round 2 Solver',
            turn: 5,
            timestamp: new Date().toISOString(),
            created_at: Date.now(),
          },
          moderatorResponse: {
            discussion_id: 'test',
            persona: 'Moderator AI',
            content: 'Round 2 Moderator',
            turn: 6,
            timestamp: new Date().toISOString(),
            created_at: Date.now(),
          },
          timestamp: new Date().toISOString(),
        },
      ];

      // Validate each round
      for (const round of rounds) {
        const result = validateRoundCompleteness(round);
        expect(result.isValid).toBe(true);

        const turnResult = validateTurnNumbers(round, {
          analyzer: calculateTurnNumber(round.roundNumber, 'Analyzer AI'),
          solver: calculateTurnNumber(round.roundNumber, 'Solver AI'),
          moderator: calculateTurnNumber(round.roundNumber, 'Moderator AI'),
        });
        expect(turnResult.isValid).toBe(true);
      }
    });
  });

  describe('Chunk Accumulation Simulation', () => {
    it('should simulate chunk accumulation matching final response', () => {
      const finalResponse = 'This is a complete response that should be displayed in full.';
      const chunks = ['This is a ', 'complete response ', 'that should be ', 'displayed in full.'];

      let accumulated = '';
      for (const chunk of chunks) {
        accumulated += chunk;
      }

      expect(accumulated).toBe(finalResponse);
      expect(accumulated.length).toBe(finalResponse.length);
    });

    it('should detect missing chunks when final is longer', () => {
      const finalResponse = 'This is a complete response that should be displayed in full.';
      const chunks = ['This is a ', 'complete response ']; // Missing chunks

      let accumulated = '';
      for (const chunk of chunks) {
        accumulated += chunk;
      }

      expect(accumulated.length).toBeLessThan(finalResponse.length);
      const missingLength = finalResponse.length - accumulated.length;
      expect(missingLength).toBeGreaterThan(0);
    });

    it('should handle continuation chunks correctly', () => {
      const initialChunks = ['This is the initial ', 'response content. '];
      const continuationChunks = ['This is continuation ', 'content added later.'];

      let accumulated = '';
      for (const chunk of initialChunks) {
        accumulated += chunk;
      }

      // Simulate continuation chunks
      for (const chunk of continuationChunks) {
        accumulated += chunk;
      }

      const finalResponse = accumulated;
      expect(finalResponse).toBe(
        'This is the initial response content. This is continuation content added later.'
      );
    });
  });
});
