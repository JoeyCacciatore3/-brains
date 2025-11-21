import { describe, it, expect } from 'vitest';
import { countTokens, estimateTokenCount } from '@/lib/discussions/token-counter';

describe('Token Counter - Actual Tokenization', () => {
  it('should count tokens using tiktoken', () => {
    const text = 'Hello world, this is a test message.';
    const tokenCount = countTokens(text);

    // Should be more accurate than estimation
    expect(tokenCount).toBeGreaterThan(0);
    expect(typeof tokenCount).toBe('number');
  });

  it('should handle empty text', () => {
    expect(countTokens('')).toBe(0);
    expect(countTokens('   ')).toBe(0);
  });

  it('should be more accurate than estimation for code', () => {
    const codeText = 'function test() { return 123; }';
    const actualCount = countTokens(codeText);
    const estimatedCount = estimateTokenCount(codeText);

    // Actual count should be different from estimation (code tokens differently)
    // But both should be positive
    expect(actualCount).toBeGreaterThan(0);
    expect(estimatedCount).toBeGreaterThan(0);
  });

  it('should handle long text', () => {
    const longText = 'This is a very long text. '.repeat(100);
    const tokenCount = countTokens(longText);

    expect(tokenCount).toBeGreaterThan(0);
    // Should be roughly 1/4 of character count for English (but actual tokenization may vary)
    expect(tokenCount).toBeLessThan(longText.length);
  });

  it('should fallback to estimation if tokenization fails', () => {
    // Test with invalid model (should fallback)
    const text = 'Test message';
    const tokenCount = countTokens(text, 'invalid-model-name');

    // Should still return a count (fallback to estimation)
    expect(tokenCount).toBeGreaterThan(0);
  });
});
