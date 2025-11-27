/**
 * Token counting utilities for discussion context management
 * Uses actual tokenization with tiktoken for OpenAI-compatible models
 * Falls back to estimation for unsupported models
 */

import { logger } from '@/lib/logger';

/**
 * Interface for tokenizer objects from tiktoken
 * Matches the structure returned by tiktoken.encoding_for_model()
 */
interface Tokenizer {
  encode: (text: string) => Uint32Array;
}

/**
 * Valid tiktoken model names
 * These are the models that tiktoken.encoding_for_model() accepts
 */
type TiktokenModel =
  | 'gpt-4'
  | 'gpt-3.5-turbo'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'text-davinci-003'
  | 'text-davinci-002'
  | 'text-davinci-001'
  | 'text-curie-001'
  | 'text-babbage-001'
  | 'text-ada-001'
  | 'davinci'
  | 'curie'
  | 'babbage'
  | 'ada'
  | 'code-davinci-002'
  | 'code-davinci-001'
  | 'code-cushman-002'
  | 'code-cushman-001'
  | 'davinci-codex'
  | 'cushman-codex'
  | 'text-davinci-edit-001'
  | 'code-davinci-edit-001'
  | 'text-embedding-ada-002'
  | 'text-similarity-davinci-001'
  | 'text-similarity-curie-001'
  | 'text-similarity-babbage-001'
  | 'text-similarity-ada-001'
  | 'text-search-davinci-doc-001'
  | 'text-search-curie-doc-001'
  | 'text-search-babbage-doc-001'
  | 'text-search-ada-doc-001'
  | 'code-search-babbage-code-001'
  | 'code-search-ada-code-001'
  | 'gpt2';

/**
 * Type guard to check if a string is a valid tiktoken model
 */
function isValidTiktokenModel(model: string): model is TiktokenModel {
  const validModels: TiktokenModel[] = [
    'gpt-4',
    'gpt-3.5-turbo',
    'gpt-4o',
    'gpt-4o-mini',
    'text-davinci-003',
    'text-davinci-002',
    'text-davinci-001',
    'text-curie-001',
    'text-babbage-001',
    'text-ada-001',
    'davinci',
    'curie',
    'babbage',
    'ada',
    'code-davinci-002',
    'code-davinci-001',
    'code-cushman-002',
    'code-cushman-001',
    'davinci-codex',
    'cushman-codex',
    'text-davinci-edit-001',
    'code-davinci-edit-001',
    'text-embedding-ada-002',
    'text-similarity-davinci-001',
    'text-similarity-curie-001',
    'text-similarity-babbage-001',
    'text-similarity-ada-001',
    'text-search-davinci-doc-001',
    'text-search-curie-doc-001',
    'text-search-babbage-doc-001',
    'text-search-ada-doc-001',
    'code-search-babbage-code-001',
    'code-search-ada-code-001',
    'gpt2',
  ];
  return validModels.includes(model as TiktokenModel);
}

// Cache tokenizers by model name
const tokenizerCache = new Map<string, Tokenizer>();

// Flag to track if tiktoken is available
let tiktokenAvailable: boolean | null = null;

/**
 * Standardized token estimation constant
 * Used consistently across the codebase for token estimation
 * Based on average English text: ~3.5 characters per token
 */
export const TOKEN_ESTIMATION_CHARS_PER_TOKEN = 3.5;

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
        // Use type assertion only after validating model name
        const validModel: TiktokenModel = isValidTiktokenModel(tiktokenModel)
          ? tiktokenModel
          : 'gpt-3.5-turbo'; // Fallback to default
        const tokenizer = tiktoken.encoding_for_model(validModel);
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
    // Use type assertion only after validating model name
    const validModel: TiktokenModel = isValidTiktokenModel(tiktokenModel)
      ? tiktokenModel
      : 'gpt-3.5-turbo'; // Fallback to default
    const tokenizer = tiktoken.encoding_for_model(validModel);
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
 * Estimate tokens from character count using standardized estimation
 * This provides a simple, consistent way to estimate tokens from character count
 * across the codebase.
 *
 * @param charCount - Number of characters to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokensFromChars(charCount: number): number {
  if (charCount <= 0) {
    return 0;
  }
  return Math.ceil(charCount / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
}

/**
 * Estimate token count from text (fallback method)
 * Uses improved estimation based on actual tokenization patterns
 *
 * ENHANCED: More accurate estimation by accounting for:
 * - Word boundaries (tokens often split at word boundaries)
 * - Whitespace (not counted in tokens but affects splitting)
 * - Punctuation (often separate tokens)
 * - Common patterns (contractions, abbreviations, etc.)
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count (more accurate than simple 4 chars/token)
 */
export function estimateTokenCount(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  // ENHANCED: More accurate estimation
  // Base estimation: account for word boundaries and whitespace
  // Typical tokenization splits on whitespace and punctuation
  // Average English word is ~4.5-5 chars, but tokens can be shorter (3-4 chars) due to subword splitting

  // Count words (split on whitespace)
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  // Note: wordCount calculated but not used (kept for potential future use)

  // Count characters excluding whitespace
  const charCountWithoutWhitespace = trimmed.replace(/\s+/g, '').length;

  // ENHANCED: Account for punctuation as separate tokens
  // Punctuation marks are often separate tokens
  const punctuationMatches = trimmed.match(/[.,!?;:()[\]{}'"]/g);
  const punctuationCount = punctuationMatches ? punctuationMatches.length : 0;

  // ENHANCED: Estimate tokens based on:
  // 1. Characters without whitespace (base estimate: ~3.5 chars per token due to subword tokenization)
  // 2. Punctuation marks (often separate tokens, ~1 per punctuation)
  // 3. Word boundaries (can affect tokenization but less significant)

  // Conservative estimate: ~3.5 chars per token for word content (standardized)
  // This is more accurate than 4 chars/token for typical English content
  const baseTokens = Math.ceil(charCountWithoutWhitespace / TOKEN_ESTIMATION_CHARS_PER_TOKEN);

  // Add punctuation tokens (most punctuation is separate tokens)
  const punctuationTokens = Math.ceil(punctuationCount * 0.8); // Most punctuation is separate tokens

  // ENHANCED: Account for subword tokenization
  // Long words (>8 chars) are often split into multiple tokens
  const longWords = words.filter(w => w.length > 8).length;
  const additionalSubwordTokens = Math.ceil(longWords * 0.3); // ~30% of long words are split

  const totalEstimatedTokens = baseTokens + punctuationTokens + additionalSubwordTokens;

  // Fallback to simple estimation if calculation seems off
  const simpleEstimate = Math.ceil(trimmed.length / 4);

  // Use the more accurate estimate, but don't go below simple estimate by more than 20%
  // This prevents underestimation which could cause context overflow
  const minEstimate = Math.floor(simpleEstimate * 0.8);
  const finalEstimate = Math.max(totalEstimatedTokens, minEstimate);

  return finalEstimate;
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
