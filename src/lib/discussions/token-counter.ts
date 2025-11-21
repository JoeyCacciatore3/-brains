/**
 * Token counting utilities for discussion context management
 * Uses actual tokenization with tiktoken for OpenAI-compatible models
 * Falls back to estimation for unsupported models
 */

import { encoding_for_model } from 'tiktoken';
import { logger } from '@/lib/logger';

// Cache tokenizers by model name
const tokenizerCache = new Map<string, ReturnType<typeof encoding_for_model>>();

/**
 * Get tokenizer for a specific model
 * Uses tiktoken for OpenAI-compatible models, falls back to estimation
 */
function getTokenizer(model?: string): {
  encode: (text: string) => Uint32Array;
  type: 'tiktoken' | 'estimation';
} | null {
  // Default to cl100k_base encoding (used by GPT-3.5, GPT-4, and most OpenAI-compatible models)
  // This works for Groq (Llama), Mistral, and most OpenRouter models
  const defaultModel = 'gpt-3.5-turbo';

  if (!model) {
    model = defaultModel;
  }

  // Normalize model name for tiktoken
  // tiktoken uses model names like 'gpt-3.5-turbo', 'gpt-4', etc.
  // For non-OpenAI models, try to map to closest OpenAI model
  let tiktokenModel = model.toLowerCase();

  // Map common models to tiktoken-compatible models
  if (tiktokenModel.includes('llama') || tiktokenModel.includes('groq')) {
    // Llama models use cl100k_base encoding (same as GPT-3.5/4)
    tiktokenModel = 'gpt-3.5-turbo';
  } else if (tiktokenModel.includes('mistral')) {
    // Mistral models use cl100k_base encoding
    tiktokenModel = 'gpt-3.5-turbo';
  }

  try {
    // Check cache first
    if (tokenizerCache.has(tiktokenModel)) {
      const tokenizer = tokenizerCache.get(tiktokenModel)!;
      return {
        encode: (text: string) => tokenizer.encode(text),
        type: 'tiktoken' as const,
      };
    }

    // Create new tokenizer
    // tiktoken accepts string model names, and encoding_for_model validates at runtime
    const tokenizer = encoding_for_model(tiktokenModel as Parameters<typeof encoding_for_model>[0]);
    tokenizerCache.set(tiktokenModel, tokenizer);

    return {
      encode: (text: string) => tokenizer.encode(text),
      type: 'tiktoken' as const,
    };
  } catch (error) {
    // If tiktoken fails, fall back to estimation
    logger.debug('Failed to create tiktoken tokenizer, using estimation', {
      model,
      tiktokenModel,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Count tokens in text using actual tokenization
 * Falls back to estimation if tokenization fails
 *
 * @param text - Text to count tokens for
 * @param model - Optional model name for model-specific tokenization
 * @returns Actual token count (or estimation if tokenization fails)
 */
export function countTokens(text: string, model?: string): number {
  if (!text || text.length === 0) {
    return 0;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  // Try to use actual tokenization
  const tokenizer = getTokenizer(model);
  if (tokenizer && tokenizer.type === 'tiktoken') {
    try {
      const tokens = tokenizer.encode(trimmed);
      return tokens.length;
    } catch (error) {
      logger.warn('Tokenization failed, falling back to estimation', {
        model,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to estimation
    }
  }

  // Fallback to estimation
  return estimateTokenCount(trimmed);
}

/**
 * Estimate token count from text (fallback method)
 * Uses ~4 characters per token for English text
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  // Rough estimation: 4 characters per token for English text
  // This is conservative and works well for most English content
  return Math.ceil(trimmed.length / 4);
}

/**
 * Get token limit from environment or use default
 *
 * Default: 4000 tokens (50% of 8K context window)
 *
 * ⚠️ SAFETY BUFFER:
 * The limit is set conservatively (50% instead of 60%) to account for:
 * - Token estimation inaccuracies
 * - Model-specific tokenization differences
 * - Additional tokens from system prompts and formatting
 *
 * This buffer helps prevent exceeding actual context limits even if
 * estimation is inaccurate.
 */
export function getTokenLimit(): number {
  const envLimit = process.env.DISCUSSION_TOKEN_LIMIT;
  if (envLimit) {
    const parsed = parseInt(envLimit, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  // Reduced from 4800 to 4000 to add safety buffer for estimation inaccuracies
  return 4000; // Default: 50% of 8K context (with safety buffer)
}

/**
 * Check if token count has reached the 60% threshold
 */
export function hasReachedThreshold(currentCount: number, limit?: number): boolean {
  const tokenLimit = limit || getTokenLimit();
  return currentCount >= tokenLimit;
}

/**
 * Calculate token percentage of limit
 */
export function getTokenPercentage(currentCount: number, limit?: number): number {
  const tokenLimit = limit || getTokenLimit();
  if (tokenLimit === 0) return 0;
  return Math.min(100, Math.round((currentCount / tokenLimit) * 100));
}
