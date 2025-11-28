/**
 * Test exchange number calculation for Analyzer starting new rounds
 * Ensures Analyzer doesn't incorrectly reference "Exchange 2" after Round 1
 */

import { describe, it, expect } from 'vitest';
import { calculateTurnNumber } from '@/lib/discussions/round-utils';
import { formatLLMPrompt } from '@/lib/discussion-context';
import type { DiscussionRound } from '@/types';
// ConversationMessage type is used in type annotations

describe('Exchange Number Calculation', () => {
  describe('calculateTurnNumber', () => {
    it('should calculate correct turn/exchange numbers', () => {
      // Round 1: Analyzer = 1, Solver = 2, Moderator = 3
      expect(calculateTurnNumber(1, 'Analyzer AI')).toBe(1);
      expect(calculateTurnNumber(1, 'Solver AI')).toBe(2);
      expect(calculateTurnNumber(1, 'Moderator AI')).toBe(3);

      // Round 2: Analyzer = 4, Solver = 5, Moderator = 6
      expect(calculateTurnNumber(2, 'Analyzer AI')).toBe(4);
      expect(calculateTurnNumber(2, 'Solver AI')).toBe(5);
      expect(calculateTurnNumber(2, 'Moderator AI')).toBe(6);

      // Round 3: Analyzer = 7, Solver = 8, Moderator = 9
      expect(calculateTurnNumber(3, 'Analyzer AI')).toBe(7);
      expect(calculateTurnNumber(3, 'Solver AI')).toBe(8);
      expect(calculateTurnNumber(3, 'Moderator AI')).toBe(9);
    });
  });

  describe('formatLLMPrompt exchange number for Analyzer', () => {
    it('should show Exchange 4 (not Exchange 2) when Analyzer starts Round 2', () => {
      // Create Round 1 with all three responses
      const round1: DiscussionRound = {
        roundNumber: 1,
        analyzerResponse: {
          discussion_id: 'test-1',
          persona: 'Analyzer AI',
          content: 'Round 1 Analyzer response',
          turn: 1,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        solverResponse: {
          discussion_id: 'test-1',
          persona: 'Solver AI',
          content: 'Round 1 Solver response',
          turn: 2,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        moderatorResponse: {
          discussion_id: 'test-1',
          persona: 'Moderator AI',
          content: 'Round 1 Moderator response',
          turn: 3,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        timestamp: new Date().toISOString(),
      };

      const rounds: DiscussionRound[] = [round1];
      const messages: ConversationMessage[] = [];
      const currentRoundNumber = 2; // Starting Round 2

      // Format prompt for Analyzer starting Round 2
      const prompt = formatLLMPrompt(
        'Test Topic',
        messages,
        false, // Not first message
        'Analyzer AI',
        undefined, // No files
        undefined, // No legacy summary
        rounds,
        undefined, // No current summary
        [], // No summaries
        {}, // No user answers
        currentRoundNumber
      );

      // CRITICAL: Check that prompt mentions Exchange 4 (not Exchange 2)
      // Round 2 Analyzer should be Exchange 4: (2-1)*3 + 1 = 4
      expect(prompt).toContain('Exchange 4');
      expect(prompt).not.toContain('Exchange 2');

      // Should mention Round 2
      expect(prompt).toContain('Round 2');

      // Should mention the previous round (Round 1)
      expect(prompt).toContain('Round 1');

      console.log('Prompt for Analyzer starting Round 2:');
      console.log(prompt);
    });

    it('should show Exchange 1 when Analyzer starts Round 1', () => {
      const rounds: DiscussionRound[] = [];
      const messages: ConversationMessage[] = [];
      const currentRoundNumber = 1;

      const prompt = formatLLMPrompt(
        'Test Topic',
        messages,
        true, // First message
        'Analyzer AI',
        undefined,
        undefined,
        rounds,
        undefined,
        [],
        {},
        currentRoundNumber
      );

      // Round 1 Analyzer should be Exchange 1
      // Should not explicitly mention exchange number in first message prompt
      // But if it does, it should be Exchange 1, not Exchange 2
      if (prompt.includes('Exchange')) {
        expect(prompt).toContain('Exchange 1');
        expect(prompt).not.toContain('Exchange 2');
      }

      console.log('Prompt for Analyzer starting Round 1:');
      console.log(prompt);
    });

    it('should show correct exchange numbers for Solver and Moderator in Round 1', () => {
      const round1: DiscussionRound = {
        roundNumber: 1,
        analyzerResponse: {
          discussion_id: 'test-1',
          persona: 'Analyzer AI',
          content: 'Round 1 Analyzer response',
          turn: 1,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        solverResponse: {
          discussion_id: 'test-1',
          persona: 'Solver AI',
          content: '', // Empty - Solver hasn't responded yet
          turn: 2,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        moderatorResponse: {
          discussion_id: 'test-1',
          persona: 'Moderator AI',
          content: '',
          turn: 3,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        timestamp: new Date().toISOString(),
      };

      const rounds: DiscussionRound[] = [round1];
      const messages: ConversationMessage[] = [];

      // Test Solver in Round 1
      const solverPrompt = formatLLMPrompt(
        'Test Topic',
        messages,
        false,
        'Solver AI',
        undefined,
        undefined,
        rounds,
        undefined,
        [],
        {},
        1
      );

      // Solver in Round 1 should be Exchange 2
      if (solverPrompt.includes('Exchange')) {
        expect(solverPrompt).toContain('Exchange 2');
      }

      // Test Moderator in Round 1 (after Solver responds)
      round1.solverResponse.content = 'Round 1 Solver response';
      const moderatorPrompt = formatLLMPrompt(
        'Test Topic',
        messages,
        false,
        'Moderator AI',
        undefined,
        undefined,
        rounds,
        undefined,
        [],
        {},
        1
      );

      // Moderator in Round 1 should be Exchange 3
      if (moderatorPrompt.includes('Exchange')) {
        expect(moderatorPrompt).toContain('Exchange 3');
      }
    });
  });
});

