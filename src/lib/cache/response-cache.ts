/**
 * Response Cache
 * Caches LLM responses for identical prompts (optional)
 */

import { logger } from '@/lib/logger';
import { getRedisClient } from '@/lib/db/redis';
import { createHash } from 'crypto';

const CACHE_ENABLED = process.env.CACHE_ENABLED !== 'false';
const CACHE_RESPONSE_CACHING = process.env.CACHE_RESPONSE_CACHING === 'true';
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || '3600000', 10); // 1 hour default
const CACHE_MAX_SIZE = parseInt(process.env.CACHE_MAX_SIZE || '1000', 10);

// In-memory cache
const responseCache = new Map<string, { response: string; timestamp: number }>();

/**
 * Generate cache key from prompt
 */
function generateCacheKey(messages: Array<{ role: string; content: string }>): string {
  const content = JSON.stringify(messages);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Get cached response
 */
export async function getCachedResponse(
  messages: Array<{ role: string; content: string }>
): Promise<string | null> {
  if (!CACHE_ENABLED || !CACHE_RESPONSE_CACHING) {
    return null;
  }

  const key = generateCacheKey(messages);

  // Check Redis first
  const redis = getRedisClient();
  if (redis) {
    try {
      const cached = await redis.get(`response_cache:${key}`);
      if (cached) {
        return cached;
      }
    } catch (error) {
      logger.warn('Failed to get cached response from Redis', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Check in-memory cache
  const cached = responseCache.get(key);
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_TTL_MS) {
      return cached.response;
    } else {
      // Expired, remove
      responseCache.delete(key);
    }
  }

  return null;
}

/**
 * Cache response
 */
export async function cacheResponse(
  messages: Array<{ role: string; content: string }>,
  response: string
): Promise<void> {
  if (!CACHE_ENABLED || !CACHE_RESPONSE_CACHING) {
    return;
  }

  const key = generateCacheKey(messages);

  // Store in Redis
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.setex(`response_cache:${key}`, Math.floor(CACHE_TTL_MS / 1000), response);
    } catch (error) {
      logger.warn('Failed to cache response in Redis', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Store in memory
  responseCache.set(key, {
    response,
    timestamp: Date.now(),
  });

  // Cleanup if cache is too large
  if (responseCache.size > CACHE_MAX_SIZE) {
    const entries = Array.from(responseCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, Math.floor(CACHE_MAX_SIZE * 0.2));
    for (const [key] of toDelete) {
      responseCache.delete(key);
    }
  }
}

/**
 * Periodic cleanup of expired entries
 */
function cleanupExpiredResponseCache(): void {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of responseCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL_MS) {
      responseCache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug('Cleaned up expired response cache entries', { count: cleaned });
  }
}

// Start periodic cleanup every 5 minutes
if (typeof setInterval !== 'undefined' && CACHE_ENABLED && CACHE_RESPONSE_CACHING) {
  setInterval(cleanupExpiredResponseCache, 5 * 60 * 1000);
}

/**
 * Clear response cache
 */
export function clearResponseCache(): void {
  responseCache.clear();
  logger.info('Response cache cleared');
}
