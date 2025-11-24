/**
 * Unit tests for round utility functions
 */

import { describe, it, expect } from 'vitest';
import type { DiscussionRound, ConversationMessage } from '@/types';
import {
  isRoundComplete,
  isRoundEmpty,
  isRoundIncomplete,
  filterCompleteRounds,
  sortRoundsByRoundNumber,
  validateRoundsSorted,
  validateRoundNumberSequence,
  validateNewRoundNumber,
  calculateTurnNumber,
  getPersonaFromTurnNumber,
  getRoundNumberFromTurnNumber,
} from '@/lib/discussions/round-utils';

describe('round-utils', () => {
  const createMockRound = (
    roundNumber: number,
    hasAnalyzer = true,
    hasSolver = true,
    hasModerator = true
  ): DiscussionRound => ({
    roundNumber,
    analyzerResponse: {
      discussion_id: 'test',
      persona: 'Analyzer AI',
      content: hasAnalyzer ? 'Analyzer response' : '',
      turn: calculateTurnNumber(roundNumber, 'Analyzer AI'),
      timestamp: new Date().toISOString(),
      created_at: Date.now(),
    },
    solverResponse: {
      discussion_id: 'test',
      persona: 'Solver AI',
      content: hasSolver ? 'Solver response' : '',
      turn: calculateTurnNumber(roundNumber, 'Solver AI'),
      timestamp: new Date().toISOString(),
      created_at: Date.now(),
    },
    moderatorResponse: {
      discussion_id: 'test',
      persona: 'Moderator AI',
      content: hasModerator ? 'Moderator response' : '',
      turn: calculateTurnNumber(roundNumber, 'Moderator AI'),
      timestamp: new Date().toISOString(),
      created_at: Date.now(),
    },
    timestamp: new Date().toISOString(),
  });

  describe('isRoundComplete', () => {
    it('should return true for complete rounds', () => {
      const round = createMockRound(1, true, true, true);
      expect(isRoundComplete(round)).toBe(true);
    });

    it('should return false for incomplete rounds', () => {
      const round = createMockRound(1, true, false, true);
      expect(isRoundComplete(round)).toBe(false);
    });

    it('should return false for empty rounds', () => {
      const round = createMockRound(1, false, false, false);
      expect(isRoundComplete(round)).toBe(false);
    });
  });

  describe('isRoundEmpty', () => {
    it('should return true for empty rounds', () => {
      const round = createMockRound(1, false, false, false);
      expect(isRoundEmpty(round)).toBe(true);
    });

    it('should return false for complete rounds', () => {
      const round = createMockRound(1, true, true, true);
      expect(isRoundEmpty(round)).toBe(false);
    });

    it('should return false for incomplete rounds', () => {
      const round = createMockRound(1, true, false, false);
      expect(isRoundEmpty(round)).toBe(false);
    });
  });

  describe('isRoundIncomplete', () => {
    it('should return true for incomplete rounds', () => {
      const round = createMockRound(1, true, false, false);
      expect(isRoundIncomplete(round)).toBe(true);
    });

    it('should return false for complete rounds', () => {
      const round = createMockRound(1, true, true, true);
      expect(isRoundIncomplete(round)).toBe(false);
    });

    it('should return false for empty rounds', () => {
      const round = createMockRound(1, false, false, false);
      expect(isRoundIncomplete(round)).toBe(false);
    });
  });

  describe('filterCompleteRounds', () => {
    it('should filter out incomplete rounds', () => {
      const rounds = [
        createMockRound(1, true, true, true), // Complete
        createMockRound(2, true, false, false), // Incomplete
        createMockRound(3, false, false, false), // Empty
        createMockRound(4, true, true, true), // Complete
      ];
      const filtered = filterCompleteRounds(rounds);
      expect(filtered.length).toBe(3);
      expect(filtered[0].roundNumber).toBe(1);
      expect(filtered[1].roundNumber).toBe(3);
      expect(filtered[2].roundNumber).toBe(4);
    });
  });

  describe('sortRoundsByRoundNumber', () => {
    it('should sort rounds by roundNumber', () => {
      const rounds = [
        createMockRound(3),
        createMockRound(1),
        createMockRound(2),
      ];
      const sorted = sortRoundsByRoundNumber(rounds);
      expect(sorted[0].roundNumber).toBe(1);
      expect(sorted[1].roundNumber).toBe(2);
      expect(sorted[2].roundNumber).toBe(3);
    });
  });

  describe('validateRoundsSorted', () => {
    it('should return true for sorted rounds', () => {
      const rounds = [
        createMockRound(1),
        createMockRound(2),
        createMockRound(3),
      ];
      expect(validateRoundsSorted(rounds)).toBe(true);
    });

    it('should return false for unsorted rounds', () => {
      const rounds = [
        createMockRound(3),
        createMockRound(1),
        createMockRound(2),
      ];
      expect(validateRoundsSorted(rounds)).toBe(false);
    });
  });

  describe('validateRoundNumberSequence', () => {
    it('should validate correct sequence', () => {
      const rounds = [
        createMockRound(1),
        createMockRound(2),
        createMockRound(3),
      ];
      const result = validateRoundNumberSequence(rounds);
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should detect gaps in sequence', () => {
      const rounds = [
        createMockRound(1),
        createMockRound(3), // Gap: missing 2
      ];
      const result = validateRoundNumberSequence(rounds);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('Gaps'))).toBe(true);
    });

    it('should detect duplicate round numbers', () => {
      const rounds = [
        createMockRound(1),
        createMockRound(2),
        createMockRound(2), // Duplicate
      ];
      const result = validateRoundNumberSequence(rounds);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
    });

    it('should detect sequence not starting at 1', () => {
      const rounds = [
        createMockRound(2),
        createMockRound(3),
      ];
      const result = validateRoundNumberSequence(rounds);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('does not start at 1'))).toBe(true);
    });
  });

  describe('validateNewRoundNumber', () => {
    it('should validate correct round number', () => {
      const rounds = [createMockRound(1), createMockRound(2)];
      const result = validateNewRoundNumber(rounds, 3);
      expect(result.isValid).toBe(true);
    });

    it('should detect incorrect round number', () => {
      const rounds = [createMockRound(1), createMockRound(2)];
      const result = validateNewRoundNumber(rounds, 5);
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('calculateTurnNumber', () => {
    it('should calculate turn numbers correctly for Round 1', () => {
      expect(calculateTurnNumber(1, 'Analyzer AI')).toBe(1);
      expect(calculateTurnNumber(1, 'Solver AI')).toBe(2);
      expect(calculateTurnNumber(1, 'Moderator AI')).toBe(3);
    });

    it('should calculate turn numbers correctly for Round 2', () => {
      expect(calculateTurnNumber(2, 'Analyzer AI')).toBe(4);
      expect(calculateTurnNumber(2, 'Solver AI')).toBe(5);
      expect(calculateTurnNumber(2, 'Moderator AI')).toBe(6);
    });

    it('should calculate turn numbers correctly for Round 3', () => {
      expect(calculateTurnNumber(3, 'Analyzer AI')).toBe(7);
      expect(calculateTurnNumber(3, 'Solver AI')).toBe(8);
      expect(calculateTurnNumber(3, 'Moderator AI')).toBe(9);
    });
  });

  describe('getPersonaFromTurnNumber', () => {
    it('should return correct persona for turn numbers', () => {
      expect(getPersonaFromTurnNumber(1)).toBe('Analyzer AI');
      expect(getPersonaFromTurnNumber(2)).toBe('Solver AI');
      expect(getPersonaFromTurnNumber(3)).toBe('Moderator AI');
      expect(getPersonaFromTurnNumber(4)).toBe('Analyzer AI');
      expect(getPersonaFromTurnNumber(5)).toBe('Solver AI');
      expect(getPersonaFromTurnNumber(6)).toBe('Moderator AI');
    });
  });

  describe('getRoundNumberFromTurnNumber', () => {
    it('should return correct round number for turn numbers', () => {
      expect(getRoundNumberFromTurnNumber(1)).toBe(1);
      expect(getRoundNumberFromTurnNumber(2)).toBe(1);
      expect(getRoundNumberFromTurnNumber(3)).toBe(1);
      expect(getRoundNumberFromTurnNumber(4)).toBe(2);
      expect(getRoundNumberFromTurnNumber(5)).toBe(2);
      expect(getRoundNumberFromTurnNumber(6)).toBe(2);
      expect(getRoundNumberFromTurnNumber(7)).toBe(3);
    });
  });
});
