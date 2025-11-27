/**
 * System Prompt Cache
 * Caches system prompt token counts to reduce calculation overhead
 */

import { logger } from '@/lib/logger';
import { countTokens } from '@/lib/discussions/token-counter';

const CACHE_ENABLED = process.env.CACHE_ENABLED !== 'false';
const CACHE_MAX_SIZE = parseInt(process.env.PROMPT_CACHE_MAX_SIZE || '1000', 10);
const CACHE_TTL_MS = parseInt(process.env.PROMPT_CACHE_TTL_MS || '3600000', 10); // 1 hour default

// Cache for system prompt token counts with timestamps
const promptTokenCache = new Map<string, { tokenCount: number; timestamp: number }>();

/**
 * Get cached system prompt token count
 */
export function getCachedPromptTokens(prompt: string): number | null {
  if (!CACHE_ENABLED) {
    return null;
  }

  const cached = promptTokenCache.get(prompt);
  if (!cached) {
    return null;
  }

  // Check expiration
  const age = Date.now() - cached.timestamp;
  if (age >= CACHE_TTL_MS) {
    promptTokenCache.delete(prompt);
    return null;
  }

  return cached.tokenCount;
}

/**
 * Cache system prompt token count
 */
export function cachePromptTokens(prompt: string, tokenCount: number): void {
  if (!CACHE_ENABLED) {
    return;
  }

  // Cleanup if cache is too large (LRU eviction)
  if (promptTokenCache.size >= CACHE_MAX_SIZE) {
    const entries = Array.from(promptTokenCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, Math.floor(CACHE_MAX_SIZE * 0.2));
    for (const [key] of toDelete) {
      promptTokenCache.delete(key);
    }
  }

  promptTokenCache.set(prompt, {
    tokenCount,
    timestamp: Date.now(),
  });
}

/**
 * Get or calculate system prompt token count
 */
export function getPromptTokens(prompt: string): number {
  // Check cache first
  const cached = getCachedPromptTokens(prompt);
  if (cached !== null) {
    return cached;
  }

  // Calculate and cache
  const tokenCount = countTokens(prompt);
  cachePromptTokens(prompt, tokenCount);

  return tokenCount;
}

/**
 * Periodic cleanup of expired entries
 */
function cleanupExpiredPromptCache(): void {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of promptTokenCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL_MS) {
      promptTokenCache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug('Cleaned up expired prompt cache entries', { count: cleaned });
  }
}

// Start periodic cleanup every 5 minutes
if (typeof setInterval !== 'undefined' && CACHE_ENABLED) {
  setInterval(cleanupExpiredPromptCache, 5 * 60 * 1000);
}

/**
 * Clear prompt cache
 */
export function clearPromptCache(): void {
  promptTokenCache.clear();
  logger.info('Prompt cache cleared');
}
