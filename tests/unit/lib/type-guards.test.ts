import { describe, it, expect } from 'vitest';
import {
  isPersona,
  isValidConversationMessagePersona,
  isUUID,
  isNonEmptyString,
  isPositiveInteger,
} from '@/lib/type-guards';

describe('Type Guards', () => {
  describe('isPersona', () => {
    it('should return true for valid personas', () => {
      expect(isPersona('Solver AI')).toBe(true);
      expect(isPersona('Analyzer AI')).toBe(true);
      expect(isPersona('User')).toBe(true);
    });

    it('should return false for invalid personas', () => {
      expect(isPersona('Invalid Persona')).toBe(false);
      expect(isPersona('')).toBe(false);
      expect(isPersona('solver ai')).toBe(false); // Case sensitive
    });
  });

  describe('isValidConversationMessagePersona', () => {
    it('should return true for valid personas', () => {
      expect(isValidConversationMessagePersona('Solver AI')).toBe(true);
      expect(isValidConversationMessagePersona('Analyzer AI')).toBe(true);
      expect(isValidConversationMessagePersona('User')).toBe(true);
    });

    it('should return false for invalid personas', () => {
      expect(isValidConversationMessagePersona('Invalid')).toBe(false);
    });
  });

  describe('isUUID', () => {
    it('should return true for valid UUIDs', () => {
      expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    });

    it('should return false for invalid UUIDs', () => {
      expect(isUUID('not-a-uuid')).toBe(false);
      expect(isUUID('550e8400-e29b-41d4-a716')).toBe(false);
      expect(isUUID('')).toBe(false);
    });
  });

  describe('isNonEmptyString', () => {
    it('should return true for non-empty strings', () => {
      expect(isNonEmptyString('hello')).toBe(true);
      expect(isNonEmptyString('  hello  ')).toBe(true); // Trimmed would be non-empty
    });

    it('should return false for empty strings and non-strings', () => {
      expect(isNonEmptyString('')).toBe(false);
      expect(isNonEmptyString('   ')).toBe(false);
      expect(isNonEmptyString(null)).toBe(false);
      expect(isNonEmptyString(undefined)).toBe(false);
      expect(isNonEmptyString(123)).toBe(false);
    });
  });

  describe('isPositiveInteger', () => {
    it('should return true for positive integers', () => {
      expect(isPositiveInteger(1)).toBe(true);
      expect(isPositiveInteger(100)).toBe(true);
    });

    it('should return false for non-positive or non-integers', () => {
      expect(isPositiveInteger(0)).toBe(false);
      expect(isPositiveInteger(-1)).toBe(false);
      expect(isPositiveInteger(1.5)).toBe(false);
      expect(isPositiveInteger('1')).toBe(false);
      expect(isPositiveInteger(null)).toBe(false);
    });
  });
});
