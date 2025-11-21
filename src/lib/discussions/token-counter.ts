/**
 * Token counting utilities for discussion context management
 * Uses actual tokenization with tiktoken for OpenAI-compatible models
 * Falls back to estimation for unsupported models
 */

import { logger } from '@/lib/logger';

// Cache tokenizers by model name
const tokenizerCache = new Map<string, any>();

// Flag to track if tiktoken is available
let tiktokenAvailable: boolean | null = null;

/**
 * Get tokenizer for a specific model
 * Uses tiktoken for OpenAI-compatible models, falls back to estimation
 */
async function getTokenizer(model?: string): Promise<{
  encode: (text: string) => Uint32Array;
  type: 'tiktoken' | 'estimation';
} | null> {
  // Check if we've already determined tiktoken is unavailable
  if (tiktokenAvailable === false) {
    return null;
  }

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

    // Try to dynamically import tiktoken
    if (tiktokenAvailable === null) {
      try {
        const tiktoken = await import('tiktoken');
        tiktokenAvailable = true;
        // Create new tokenizer
        const tokenizer = tiktoken.encoding_for_model(tiktokenModel as any);
        tokenizerCache.set(tiktokenModel, tokenizer);

        return {
          encode: (text: string) => tokenizer.encode(text),
          type: 'tiktoken' as const,
        };
      } catch (importError) {
        tiktokenAvailable = false;
        logger.debug('Tiktoken not available, using estimation fallback', {
          error: importError instanceof Error ? importError.message : String(importError),
        });
        return null;
      }
    }

    // If we get here, tiktoken is available
    const tiktoken = await import('tiktoken');
    const tokenizer = tiktoken.encoding_for_model(tiktokenModel as any);
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
 * Note: This is now synchronous and always uses estimation
 * Actual tokenization would require async handling throughout the codebase
 *
 * @param text - Text to count tokens for
 * @param _model - Optional model name for model-specific tokenization (unused in sync version)
 * @returns Estimated token count
 */
export function countTokens(text: string, _model?: string): number {
  if (!text || text.length === 0) {
    return 0;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  // For now, always use estimation to avoid async complications
  // The estimation is conservative and works well for most use cases
  return estimateTokenCount(trimmed);
}

/**
 * Async version of countTokens that attempts to use actual tokenization
 * Use this when you can handle async operations
 *
 * @param text - Text to count tokens for
 * @param model - Optional model name for model-specific tokenization
 * @returns Actual token count (or estimation if tokenization fails)
 */
export async function countTokensAsync(text: string, model?: string): Promise<number> {
  if (!text || text.length === 0) {
    return 0;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  // Try to use actual tokenization
  try {
    const tokenizer = await getTokenizer(model);
    if (tokenizer && tokenizer.type === 'tiktoken') {
      const tokens = tokenizer.encode(trimmed);
      return tokens.length;
    }
  } catch (error) {
    logger.warn('Tokenization failed, falling back to estimation', {
      model,
      error: error instanceof Error ? error.message : String(error),
    });
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
