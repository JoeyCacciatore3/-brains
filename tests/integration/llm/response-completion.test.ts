import { describe, it, expect } from 'vitest';
import { isSentenceComplete, validateSentenceCompleteness } from '@/lib/llm/sentence-validation';

/**
 * Tests to verify response completion logic
 * Ensures that incomplete responses are detected and completed
 */
describe('Response Completion Tests', () => {
  describe('Sentence Completeness Validation', () => {
    it('should identify complete sentences ending with period', () => {
      expect(isSentenceComplete('This is a complete sentence.')).toBe(true);
      expect(isSentenceComplete('Another complete sentence.')).toBe(true);
    });

    it('should identify complete sentences ending with exclamation', () => {
      expect(isSentenceComplete('This is exciting!')).toBe(true);
    });

    it('should identify complete sentences ending with question mark', () => {
      expect(isSentenceComplete('Is this complete?')).toBe(true);
    });

    it('should identify incomplete sentences ending with comma', () => {
      expect(isSentenceComplete('This is incomplete,')).toBe(false);
    });

    it('should identify incomplete sentences ending with conjunction', () => {
      expect(isSentenceComplete('This is incomplete and')).toBe(false);
      expect(isSentenceComplete('This is incomplete but')).toBe(false);
    });

    it('should identify incomplete sentences ending with preposition', () => {
      expect(isSentenceComplete('This is incomplete with')).toBe(false);
      expect(isSentenceComplete('This is incomplete for')).toBe(false);
    });

    it('should be lenient with short responses', () => {
      // Short responses without punctuation should be more lenient
      expect(isSentenceComplete('Yes')).toBe(true);
      expect(isSentenceComplete('No')).toBe(true);
      expect(isSentenceComplete('OK')).toBe(true);
    });

    it('should identify incomplete sentences with unclosed quotes', () => {
      expect(isSentenceComplete('This has "unclosed quote')).toBe(false);
      expect(isSentenceComplete('This has "closed quote"')).toBe(true);
    });

    it('should identify incomplete sentences with unclosed parentheses', () => {
      expect(isSentenceComplete('This has (unclosed paren')).toBe(false);
      expect(isSentenceComplete('This has (closed paren)')).toBe(true);
    });
  });

  describe('Sentence Validation with Finish Reason', () => {
    it('should validate complete sentence with stop finish reason', () => {
      const result = validateSentenceCompleteness(
        'This is a complete sentence.',
        'stop',
        'TestProvider',
        2000
      );
      expect(result).toBe(true);
    });

    it('should identify incomplete sentence with stop finish reason', () => {
      const result = validateSentenceCompleteness(
        'This is incomplete and',
        'stop',
        'TestProvider',
        2000
      );
      expect(result).toBe(false);
    });

    it('should identify incomplete sentence with length finish reason', () => {
      const result = validateSentenceCompleteness(
        'This sentence was truncated',
        'length',
        'TestProvider',
        2000
      );
      // Should return false because it was truncated by length
      expect(result).toBe(false);
    });

    it('should identify suspiciously short responses', () => {
      const shortResponse = 'Hi';
      const result = validateSentenceCompleteness(
        shortResponse,
        'stop',
        'TestProvider',
        2000
      );
      // Short responses should be flagged for completion
      expect(result).toBe(false);
    });

    it('should be lenient with medium-length responses without punctuation', () => {
      // Responses 100-200 chars without punctuation should be more lenient
      const mediumResponse = 'This is a medium length response that does not end with punctuation but is still reasonable';
      const result = validateSentenceCompleteness(
        mediumResponse,
        'stop',
        'TestProvider',
        2000
      );
      // Should be lenient if it doesn't end with incomplete patterns
      expect(result).toBe(true);
    });

    it('should identify long responses without punctuation as incomplete', () => {
      const longResponse = 'This is a very long response that does not end with punctuation and should be considered incomplete because it is over 200 characters long and lacks proper sentence ending';
      const result = validateSentenceCompleteness(
        longResponse,
        'stop',
        'TestProvider',
        2000
      );
      expect(result).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings', () => {
      expect(isSentenceComplete('')).toBe(false);
      expect(isSentenceComplete('   ')).toBe(false);
    });

    it('should handle responses with only whitespace', () => {
      expect(isSentenceComplete('   ')).toBe(false);
    });

    it('should handle responses ending with abbreviations', () => {
      // Abbreviations ending with period should be considered complete
      expect(isSentenceComplete('Dr. Smith')).toBe(true);
      expect(isSentenceComplete('U.S.A.')).toBe(true);
    });

    it('should handle responses with multiple sentences', () => {
      expect(isSentenceComplete('First sentence. Second sentence.')).toBe(true);
      expect(isSentenceComplete('First sentence. Second sentence')).toBe(false);
    });

    it('should handle responses ending with ellipsis', () => {
      expect(isSentenceComplete('This ends with...')).toBe(false);
      expect(isSentenceComplete('This ends with..')).toBe(false);
    });
  });
});
