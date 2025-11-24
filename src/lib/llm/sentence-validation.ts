/**
 * Sentence completeness validation utilities
 * Ensures LLM responses end with complete sentences
 *
 * This validation is designed to be balanced - not too strict (which would trigger
 * unnecessary continuations) and not too lenient (which would miss truly incomplete responses).
 * It checks for:
 * - Incomplete quotes, parentheses, brackets
 * - Trailing ellipsis
 * - Common incomplete patterns (conjunctions, prepositions, etc.)
 * - Very short responses without punctuation
 *
 * Note: Some patterns (like ending with "-ing" or "-ly") may have false positives,
 * but this is acceptable as continuation logic will handle it gracefully.
 */

import { logger } from '@/lib/logger';

/**
 * Check if a response ends with a complete sentence
 * A complete sentence ends with '.', '!', or '?' followed by whitespace or end of string
 * @param content The content to validate
 * @returns true if the sentence appears complete, false otherwise
 */
export function isSentenceComplete(content: string): boolean {
  if (!content || content.trim().length === 0) {
    return false;
  }

  const trimmed = content.trim();
  const lastChar = trimmed[trimmed.length - 1];

  // Check for incomplete quotes (odd number of unescaped quotes)
  const unescapedQuotes = trimmed.match(/(?<!\\)"/g);
  if (unescapedQuotes && unescapedQuotes.length % 2 !== 0) {
    return false; // Incomplete quote
  }

  // Check for incomplete parentheses/brackets
  const openParens = (trimmed.match(/\(/g) || []).length;
  const closeParens = (trimmed.match(/\)/g) || []).length;
  const openBrackets = (trimmed.match(/\[/g) || []).length;
  const closeBrackets = (trimmed.match(/\]/g) || []).length;
  const openBraces = (trimmed.match(/\{/g) || []).length;
  const closeBraces = (trimmed.match(/\}/g) || []).length;

  if (openParens > closeParens || openBrackets > closeBrackets || openBraces > closeBraces) {
    return false; // Incomplete brackets/parentheses
  }

  // Check for trailing ellipsis (might indicate incomplete thought)
  if (trimmed.endsWith('...') || trimmed.endsWith('..')) {
    return false;
  }

  // Check if ends with sentence-ending punctuation
  if (lastChar === '.' || lastChar === '!' || lastChar === '?') {
    // Check if it's an abbreviation (common abbreviations that end with period)
    const commonAbbreviations = [
      /\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|e\.g|i\.e|a\.m|p\.m|U\.S|U\.K|Ph\.D|B\.A|M\.A)\s*$/i,
      /\b[A-Z]\.\s*$/, // Single capital letter with period (e.g., "A.")
    ];

    // If it matches an abbreviation pattern, check if there's more content after
    // For now, we'll consider it complete if it ends with punctuation
    // The context should make it clear if it's truly incomplete

    // Additional check: if the period is immediately after a lowercase letter and there's no space,
    // it might be an abbreviation, but we'll still consider it complete
    return true;
  }

  // Check for common incomplete patterns
  const incompletePatterns = [
    // Ends with conjunction/relative pronoun/subordinating conjunction
    /\b(and|or|but|so|because|since|when|where|while|if|that|which|who|what|how|why|although|though|unless|until|as|than)\s*$/i,
    // Ends with auxiliary verb
    /\b(is|are|was|were|has|have|had|will|would|should|could|can|may|might|must|shall|do|does|did)\s*$/i,
    // Ends with preposition
    /\b(to|for|with|from|by|at|in|on|of|about|into|onto|upon|over|under|through|during|before|after|above|below|between|among|within|without)\s*$/i,
    // Ends with punctuation that suggests continuation
    /,\s*$/, // Ends with comma
    /:\s*$/, // Ends with colon
    /;\s*$/, // Ends with semicolon
    /-\s*$/, // Ends with dash
    // Ends with incomplete word patterns
    /\b\w+ing\s*$/i, // Ends with "-ing" (might be incomplete gerund)
    /\b\w+ly\s*$/i, // Ends with "-ly" adverb (might be incomplete)
  ];

  for (const pattern of incompletePatterns) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  // Check for very short responses that don't end with punctuation
  // These might be cut off mid-sentence
  if (trimmed.length < 20 && !/[.!?]\s*$/.test(trimmed)) {
    // Very short responses without punctuation are likely incomplete
    return false;
  }

  // Check for incomplete list items (ends with comma, dash, or number with period)
  if (/^\s*[-•*]\s/.test(trimmed) && /[,\-]\s*$/.test(trimmed)) {
    return false; // Incomplete list item
  }

  // ENHANCED: Check for responses ending mid-word (cut off mid-token)
  // This catches truncation that happens mid-word
  const lastWord = trimmed.split(/\s+/).pop() || '';
  if (lastWord.length > 0 && lastWord.length < 3 && !/[.!?]$/.test(lastWord)) {
    // Very short last word might indicate mid-word truncation
    return false;
  }

  // ENHANCED: Check for responses that end with incomplete sentences
  // Look for patterns like ending with lowercase letter followed by nothing (likely cut off)
  const lastFewChars = trimmed.slice(-10);
  if (/[a-z]\s*$/.test(lastFewChars) && !/[.!?]\s*$/.test(trimmed)) {
    // Ends with lowercase letter and no punctuation - likely incomplete
    return false;
  }

  // ENHANCED: Check for responses near typical token limits that don't end properly
  // If response is long (>300 chars) and doesn't end with punctuation, it's likely truncated
  if (trimmed.length > 300 && !/[.!?]\s*$/.test(trimmed)) {
    return false; // Long responses should end with punctuation
  }

  // ENHANCED: Check for incomplete paragraphs (multiple sentences but no final punctuation)
  const sentenceCount = (trimmed.match(/[.!?]\s+/g) || []).length;
  if (sentenceCount > 0 && !/[.!?]\s*$/.test(trimmed)) {
    // Has sentences but doesn't end with punctuation - likely incomplete
    return false;
  }

  // ADJUSTED: Be more lenient with responses that don't end with punctuation
  // Only mark as incomplete if:
  // 1. Response is >200 chars without punctuation (likely incomplete)
  // 2. Response is >100 chars and ends with incomplete patterns (conjunctions, prepositions, etc.)
  // This reduces false positives while still catching truly incomplete responses
  if (trimmed.length > 200 && !/[.!?]\s*$/.test(trimmed)) {
    return false; // Long responses (>200 chars) should end with punctuation
  }

  // For responses 100-200 chars without punctuation, check if they end with incomplete patterns
  if (trimmed.length > 100 && trimmed.length <= 200 && !/[.!?]\s*$/.test(trimmed)) {
    // Check if it ends with incomplete patterns (already checked above, but be more lenient)
    // If it doesn't match incomplete patterns, consider it complete
    const endsWithIncompletePattern = /\b(and|or|but|so|because|since|when|where|while|if|that|which|who|what|how|why|although|though|unless|until|as|than|to|for|with|from|by|at|in|on|of|about|into|onto|upon|over|under|through|during|before|after|above|below|between|among|within|without|is|are|was|were|has|have|had|will|would|should|could|can|may|might|must|shall|do|does|did)\s*$/i.test(trimmed);
    if (endsWithIncompletePattern) {
      return false; // Ends with incomplete pattern
    }
    // Otherwise, consider it complete (may be a list or formatted text)
  }

  // For shorter responses without punctuation, be lenient
  // but still check for incomplete patterns above
  return true;
}

/**
 * Validate sentence completeness and log warnings
 * @param content The content to validate
 * @param finishReason The finish reason from the LLM API
 * @param provider The provider name for logging
 * @param maxTokens Optional max tokens to check if response is near limit
 * @returns true if sentence is complete or finishReason is 'length', false otherwise
 */
export function validateSentenceCompleteness(
  content: string,
  finishReason: string | null,
  provider: string,
  maxTokens?: number
): boolean {
  const isComplete = isSentenceComplete(content);
  const trimmedLength = content.trim().length;

  // Log validation decision for debugging
  logger.debug('Validating sentence completeness', {
    provider,
    finishReason,
    contentLength: trimmedLength,
    isComplete,
    maxTokens,
    lastChars: content.slice(-50),
  });

  // ENHANCED: Length-based heuristics - responses near token limit are more likely truncated
  // Rough estimate: 1 token ≈ 4 characters for English text
  const estimatedTokens = Math.ceil(trimmedLength / 4);
  const isNearTokenLimit = maxTokens && estimatedTokens >= maxTokens * 0.9; // Within 90% of limit

  if (!isComplete && finishReason !== 'length') {
    logger.warn('Response appears incomplete (not due to length limit)', {
      provider,
      finishReason,
      contentLength: trimmedLength,
      estimatedTokens,
      maxTokens,
      isNearTokenLimit,
      lastChars: content.slice(-50),
    });
    return false;
  }

  if (!isComplete && finishReason === 'length') {
    // This is expected - will be handled by continuation logic
    logger.debug('Response incomplete due to length limit (will be continued)', {
      provider,
      contentLength: trimmedLength,
      estimatedTokens,
      maxTokens,
    });
    return false;
  }

  // ENHANCED: Even if sentence appears complete, check if we're near token limit
  // This catches cases where the model stopped just before the limit but the response feels incomplete
  if (isNearTokenLimit && finishReason === 'stop' && trimmedLength > 200) {
    // Check if response ends abruptly (e.g., mid-paragraph, no conclusion)
    const lastParagraph = content.trim().split('\n\n').pop() || '';
    const hasConclusion = /(conclusion|summary|therefore|in summary|to conclude|finally|in conclusion)/i.test(
      lastParagraph
    );
    if (!hasConclusion && !/[.!?]\s*$/.test(content.trim())) {
      logger.warn('Response near token limit may be incomplete despite appearing complete', {
        provider,
        contentLength: trimmedLength,
        estimatedTokens,
        maxTokens,
        lastChars: content.slice(-100),
      });
      return false; // Treat as incomplete to trigger completion
    }
  }

  return true;
}
