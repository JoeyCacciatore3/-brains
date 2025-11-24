/**
 * Base Provider Abstract Class
 * Standardizes streaming and completion logic across all providers
 * Ensures consistent behavior and easier bug fixes
 */

import type { LLMMessage } from '@/lib/llm/types';
import { logger } from '@/lib/logger';
import { validateSentenceCompleteness } from '@/lib/llm/sentence-validation';
import { LLM_CONFIG } from '@/lib/config';

export interface StreamResult {
  content: string;
  finishReason: string | null;
  hadCompletion: boolean;
}

/**
 * Abstract base class for LLM providers
 * Provides common logic for streaming and completion
 */
export abstract class BaseProvider {
  protected config: {
    model: string;
    maxTokens: number;
    temperature: number;
  };

  constructor(config: { model: string; maxTokens: number; temperature: number }) {
    this.config = config;
  }

  /**
   * Stream messages and handle completion
   * This is the main entry point that all providers should use
   */
  async stream(messages: LLMMessage[], onChunk: (chunk: string) => void): Promise<string> {
    let fullContent = '';
    let finishReason: string | null = null;

    // Stream initial response
    const streamResult = await this.streamInternal(messages, (chunk: string) => {
      fullContent += chunk;
      onChunk(chunk);
    });

    fullContent = streamResult.content;
    finishReason = streamResult.finishReason;

    // Check if completion is needed
    const needsCompletion = this.shouldComplete(fullContent, finishReason);

    // PHASE 1: DIAGNOSTIC LOGGING - Consistent token estimation
    // Use 3.5 chars per token for consistency with shouldComplete() logic
    const estimatedTokens = Math.ceil(fullContent.trim().length / 3.5);
    const isNearTokenLimit = this.config.maxTokens && estimatedTokens >= this.config.maxTokens * 0.85;
    logger.info('🔍 COMPLETION DECISION: Checking if response needs completion', {
      provider: this.constructor.name,
      initialLength: fullContent.length,
      trimmedLength: fullContent.trim().length,
      estimatedTokens,
      maxTokens: this.config.maxTokens,
      tokenUtilization: this.config.maxTokens ? `${((estimatedTokens / this.config.maxTokens) * 100).toFixed(1)}%` : 'N/A',
      finishReason,
      needsCompletion,
      isNearTokenLimit,
      endsWithPunctuation: /[.!?]\s*$/.test(fullContent.trim()),
      lastChars: fullContent.trim().slice(-50),
      timestamp: new Date().toISOString(),
    });

    if (needsCompletion) {
      logger.info('✅ COMPLETION TRIGGERED: Response needs completion', {
        provider: this.constructor.name,
        initialLength: fullContent.length,
        trimmedLength: fullContent.trim().length,
        finishReason,
        estimatedTokens,
        maxTokens: this.config.maxTokens,
        reason: finishReason === 'length' ? 'finishReason=length' :
                fullContent.trim().length < 100 ? 'suspiciouslyShort' :
                isNearTokenLimit ? 'nearTokenLimit' :
                !/[.!?]\s*$/.test(fullContent.trim()) ? 'incompleteSentence' :
                'other',
        timestamp: new Date().toISOString(),
      });

      // Complete the thought
      // CRITICAL: Always pass onChunk callback to ensure continuation chunks are emitted
      const continuation = await this.completeThoughtInternal(fullContent, messages, onChunk);
      if (continuation.trim()) {
        fullContent = fullContent + continuation;
        logger.info('✅ COMPLETION SUCCESS: Thought completion successful', {
          provider: this.constructor.name,
          continuationLength: continuation.length,
          initialLength: fullContent.length - continuation.length,
          totalLength: fullContent.length,
          totalTrimmedLength: fullContent.trim().length,
          finalEstimatedTokens: Math.ceil(fullContent.trim().length / 3.5),
          onChunkProvided: !!onChunk,
          timestamp: new Date().toISOString(),
        });
      } else {
        logger.warn('⚠️ COMPLETION EMPTY: Continuation returned empty string', {
          provider: this.constructor.name,
          initialLength: fullContent.length,
          finishReason,
          onChunkProvided: !!onChunk,
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      logger.debug('✅ COMPLETION NOT NEEDED: Response appears complete', {
        provider: this.constructor.name,
        length: fullContent.length,
        finishReason,
        estimatedTokens,
        timestamp: new Date().toISOString(),
      });
    }

    return fullContent;
  }

  /**
   * Internal streaming implementation (provider-specific)
   * Must be implemented by each provider
   */
  protected abstract streamInternal(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void
  ): Promise<StreamResult>;

  /**
   * Internal completion implementation (provider-specific)
   * Must be implemented by each provider
   */
  protected abstract completeThoughtInternal(
    truncatedContent: string,
    originalMessages: LLMMessage[],
    onChunk?: (chunk: string) => void
  ): Promise<string>;

  /**
   * Determine if response needs completion
   * Common logic across all providers
   * CRITICAL: Be more aggressive about detecting incomplete responses
   */
  protected shouldComplete(content: string, finishReason: string | null): boolean {
    const trimmedContent = content.trim();
    const trimmedLength = trimmedContent.length;

    // CRITICAL FIX: Always complete if finishReason is 'length' (token limit reached)
    if (finishReason === 'length') {
      logger.info('🔍 Completion triggered: finishReason is "length"', {
        provider: this.constructor.name,
        contentLength: trimmedLength,
        maxTokens: this.config.maxTokens,
      });
      return true;
    }

    // Check sentence completeness
    const isComplete = validateSentenceCompleteness(
      content,
      finishReason || 'stop',
      this.constructor.name,
      this.config.maxTokens
    );

    // PHASE 3: COMPLETION LOGIC FIX - More accurate token estimation
    // Use consistent estimation: ~3.5 chars per token for English text (matches expectedLengthFromTokens calculation)
    const estimatedTokens = Math.ceil(trimmedLength / 3.5);
    // Lower threshold to 55% to catch truncation earlier, accounting for estimation inaccuracy
    const isNearTokenLimit = this.config.maxTokens && estimatedTokens >= this.config.maxTokens * 0.55;

    // PHASE 3: COMPLETION LOGIC FIX - More aggressive detection of incomplete responses
    // System prompts request 2-4 paragraphs (300-500 words ≈ 1200-2000 chars)
    // Any response < 600 chars is suspiciously short
    const isSuspiciouslyShort = trimmedLength < 600 && finishReason === 'stop';
    const endsMidWord = /[a-z]\s*$/.test(trimmedContent) && !/[.!?]\s*$/.test(trimmedContent);
    // Any response > 200 chars without punctuation is likely incomplete
    const endsMidSentence = trimmedLength > 200 && !/[.!?]\s*$/.test(trimmedContent);

    // CRITICAL FIX: Check if response ends with incomplete thought patterns
    // Expanded patterns to catch more incomplete thoughts
    const endsWithIncompletePattern = /(?:,|;|:|and|or|but|however|although|because|since|when|if|while|though|that|which|who|what|where|why|how|also|additionally|furthermore|moreover|specifically|particularly|especially|notably|importantly|significantly|similarly|likewise|conversely|alternatively|meanwhile|subsequently|therefore|consequently|thus|hence|accordingly)\s*$/i.test(trimmedContent);

    // ENHANCED: Check for responses that end mid-clause or mid-sentence structure
    // Look for incomplete sentence structures that suggest truncation
    const endsMidClause = /(?:^|\s)(?:for|with|by|from|to|of|in|on|at|about|under|over|through|during|before|after|above|below|between|among|within|without|into|onto|upon)\s+\w+\s*$/i.test(trimmedContent) && !/[.!?]\s*$/.test(trimmedContent);

    // Check for incomplete quotes or citations
    const endsIncompleteQuote = /"[^"]*$/.test(trimmedContent) || /'[^']*$/.test(trimmedContent);

    // Check for incomplete list items
    const endsIncompleteList = /^\s*[-•*]\s/m.test(trimmedContent) && /[,\-]\s*$/.test(trimmedContent);

    // PHASE 3: COMPLETION LOGIC FIX - More accurate expected length calculation
    // System prompts request 2-4 paragraphs (300-500 words)
    // 300 words ≈ 1200 chars, 500 words ≈ 2000 chars
    // Minimum for 2 paragraphs is ~1200 chars (not 600)
    const expectedMinLength = 1200; // Minimum for 2 paragraphs (~300 words)
    const isTooShortForExpected = trimmedLength < expectedMinLength && finishReason === 'stop' && !isComplete;

    // PHASE 3: COMPLETION LOGIC FIX - Always trigger completion if response < 1200 chars and doesn't end with punctuation
    // This ensures we catch responses that are shorter than the expected 2-4 paragraphs
    const isBelowMinimumLength = trimmedLength < 1200 && !/[.!?]\s*$/.test(trimmedContent) && finishReason === 'stop';

    // PHASE 3: COMPLETION LOGIC FIX - More accurate expected length from tokens
    // If we have 2000 max tokens, we should get ~7000 chars for a full response (3.5 chars/token)
    // If response is <50% of expected length and doesn't end properly, it's likely truncated
    const expectedLengthFromTokens = this.config.maxTokens * 3.5; // ~3.5 chars per token on average
    const isMuchShorterThanExpected =
      this.config.maxTokens &&
      trimmedLength < expectedLengthFromTokens * 0.5 &&
      finishReason === 'stop' &&
      !isComplete &&
      trimmedLength > 500; // Only check if response is substantial enough (increased from 200)

    const needsCompletion = (
      !isComplete ||
      isSuspiciouslyShort ||
      isNearTokenLimit ||
      endsMidWord ||
      endsMidSentence ||
      endsWithIncompletePattern ||
      endsMidClause ||
      endsIncompleteQuote ||
      endsIncompleteList ||
      isTooShortForExpected ||
      isMuchShorterThanExpected ||
      isBelowMinimumLength ||
      !finishReason
    );

    if (needsCompletion) {
      logger.info('🔍 Completion triggered: Response appears incomplete', {
        provider: this.constructor.name,
        contentLength: trimmedLength,
        estimatedTokens,
        maxTokens: this.config.maxTokens,
        finishReason,
        reasons: {
          isComplete,
          isSuspiciouslyShort,
          isNearTokenLimit,
          endsMidWord,
          endsMidSentence,
          endsWithIncompletePattern,
          endsMidClause,
          endsIncompleteQuote,
          endsIncompleteList,
          isTooShortForExpected,
          isMuchShorterThanExpected,
          isBelowMinimumLength,
          noFinishReason: !finishReason,
        },
      });
    }

    return needsCompletion;
  }

  /**
   * Calculate continuation tokens based on response length
   * Common logic across all providers
   */
  protected calculateContinuationTokens(responseLength: number): number {
    let continuationPercentage = 0.2; // Default 20%
    if (responseLength < 100) {
      continuationPercentage = 0.4; // 40% for very short responses
    } else if (responseLength < 200) {
      continuationPercentage = 0.3; // 30% for short responses
    }
    return Math.max(50, Math.ceil(this.config.maxTokens * continuationPercentage));
  }
}
