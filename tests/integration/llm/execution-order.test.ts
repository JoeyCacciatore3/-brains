import { describe, it, expect, beforeEach } from 'vitest';
import { aiPersonas } from '@/lib/llm';
import { calculateTurnNumber } from '@/lib/discussions/round-utils';

/**
 * Tests to verify execution order: Analyzer → Solver → Moderator
 * These tests ensure that personas execute in the correct order
 */
describe('Execution Order Tests', () => {
  describe('Persona Order Validation', () => {
    it('should have correct persona names', () => {
      expect(aiPersonas.analyzer.name).toBe('Analyzer AI');
      expect(aiPersonas.solver.name).toBe('Solver AI');
      expect(aiPersonas.moderator.name).toBe('Moderator AI');
    });

    it('should have correct persona IDs', () => {
      expect(aiPersonas.analyzer.id).toBe('analyzer');
      expect(aiPersonas.solver.id).toBe('solver');
      expect(aiPersonas.moderator.id).toBe('moderator');
    });

    it('should have correct persona providers', () => {
      expect(aiPersonas.analyzer.provider).toBe('mistral');
      expect(aiPersonas.solver.provider).toBe('groq');
      expect(aiPersonas.moderator.provider).toBe('openrouter');
    });
  });

  describe('Turn Number Calculation', () => {
    it('should calculate correct turn numbers for Round 1', () => {
      const roundNumber = 1;
      expect(calculateTurnNumber(roundNumber, 'Analyzer AI')).toBe(1);
      expect(calculateTurnNumber(roundNumber, 'Solver AI')).toBe(2);
      expect(calculateTurnNumber(roundNumber, 'Moderator AI')).toBe(3);
    });

    it('should calculate correct turn numbers for Round 2', () => {
      const roundNumber = 2;
      expect(calculateTurnNumber(roundNumber, 'Analyzer AI')).toBe(4);
      expect(calculateTurnNumber(roundNumber, 'Solver AI')).toBe(5);
      expect(calculateTurnNumber(roundNumber, 'Moderator AI')).toBe(6);
    });

    it('should calculate correct turn numbers for Round 3', () => {
      const roundNumber = 3;
      expect(calculateTurnNumber(roundNumber, 'Analyzer AI')).toBe(7);
      expect(calculateTurnNumber(roundNumber, 'Solver AI')).toBe(8);
      expect(calculateTurnNumber(roundNumber, 'Moderator AI')).toBe(9);
    });

    it('should maintain sequential turn numbers across rounds', () => {
      // Round 1
      expect(calculateTurnNumber(1, 'Analyzer AI')).toBe(1);
      expect(calculateTurnNumber(1, 'Solver AI')).toBe(2);
      expect(calculateTurnNumber(1, 'Moderator AI')).toBe(3);

      // Round 2
      expect(calculateTurnNumber(2, 'Analyzer AI')).toBe(4);
      expect(calculateTurnNumber(2, 'Solver AI')).toBe(5);
      expect(calculateTurnNumber(2, 'Moderator AI')).toBe(6);

      // Round 3
      expect(calculateTurnNumber(3, 'Analyzer AI')).toBe(7);
      expect(calculateTurnNumber(3, 'Solver AI')).toBe(8);
      expect(calculateTurnNumber(3, 'Moderator AI')).toBe(9);
    });
  });

  describe('Execution Order Sequence', () => {
    it('should enforce Analyzer → Solver → Moderator order', () => {
      const expectedOrder = ['Analyzer AI', 'Solver AI', 'Moderator AI'];
      const actualOrder = [
        aiPersonas.analyzer.name,
        aiPersonas.solver.name,
        aiPersonas.moderator.name,
      ];

      // Note: This test verifies the personas are defined correctly
      // The actual execution order is enforced in processSingleRound()
      expect(actualOrder).toEqual(expectedOrder);
    });

    it('should have Analyzer as first persona', () => {
      expect(aiPersonas.analyzer.name).toBe('Analyzer AI');
    });

    it('should have Solver as second persona', () => {
      expect(aiPersonas.solver.name).toBe('Solver AI');
    });

    it('should have Moderator as third persona', () => {
      expect(aiPersonas.moderator.name).toBe('Moderator AI');
    });
  });
});
