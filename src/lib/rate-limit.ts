// getRedisClient not currently used but kept for future Redis-based rate limiting
// import { getRedisClient } from './db/redis';
import { logger } from './logger';
import { RATE_LIMIT_CONFIG, RATE_LIMIT_TIERS, type RateLimitTier } from './config';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Legacy constants kept for backward compatibility (now using tier-based limits)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MAX_REQUESTS = RATE_LIMIT_CONFIG.MAX_REQUESTS;
const WINDOW_MS = RATE_LIMIT_CONFIG.WINDOW_MS;

/**
 * Periodic cleanup of expired rate limit entries (in-memory store only)
 * Runs every 60 seconds to prevent memory leaks
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}

// Store interval IDs for cleanup on shutdown
let cleanupExpiredEntriesIntervalId: ReturnType<typeof setInterval> | null = null;
let cleanupExpiredOperationEntriesIntervalId: ReturnType<typeof setInterval> | null = null;

// Start periodic cleanup every 60 seconds
if (typeof setInterval !== 'undefined') {
  cleanupExpiredEntriesIntervalId = setInterval(cleanupExpiredEntries, 60000);
}

/**
 * Check rate limit using Redis (distributed rate limiting)
 * @param ip - IP address to check
 * @param tier - Rate limit tier (defaults to 'anonymous')
 * @returns Promise<boolean> - true if rate limit exceeded, false otherwise
 */
async function checkRateLimitRedis(ip: string, tier: RateLimitTier = 'anonymous'): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    return false; // Fall back to in-memory if Redis unavailable
  }

  try {
    const tierConfig = RATE_LIMIT_TIERS[tier];
    const key = `rate_limit:${tier}:${ip}`;

    // Get current count
    const count = await redis.incr(key);

    // Set TTL on first request (when count is 1)
    if (count === 1) {
      await redis.pexpire(key, tierConfig.window);
    }

    // Check if limit exceeded
    if (count > tierConfig.max) {
      return true; // Rate limit exceeded
    }

    return false;
  } catch (error) {
    // If Redis fails, ALWAYS fall back to in-memory (never return false - security risk)
    logger.error('Redis rate limit check failed, falling back to in-memory', {
      error: error instanceof Error ? error.message : String(error),
      ip,
      tier,
    });
    // Use in-memory fallback instead of returning false
    return checkRateLimitMemory(ip, tier);
  }
}

/**
 * Check rate limit using in-memory store (fallback)
 * @param ip - IP address to check
 * @param tier - Rate limit tier (defaults to 'anonymous')
 * @returns boolean - true if rate limit exceeded, false otherwise
 */
function checkRateLimitMemory(ip: string, tier: RateLimitTier = 'anonymous'): boolean {
  const tierConfig = RATE_LIMIT_TIERS[tier];
  const key = `${tier}:${ip}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetTime < now) {
    // Create new entry or reset expired one
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + tierConfig.window,
    });
    return false;
  }

  if (entry.count >= tierConfig.max) {
    return true; // Rate limit exceeded
  }

  // Increment count
  entry.count += 1;
  return false;
}

/**
 * Check if an IP address has exceeded the rate limit
 * Uses Redis if available, falls back to in-memory store
 * @param ip - IP address to check
 * @param tier - Rate limit tier (defaults to 'anonymous' for backward compatibility)
 * @returns Promise<boolean> - true if rate limit is exceeded, false otherwise
 */
export async function checkRateLimit(ip: string, tier: RateLimitTier = 'anonymous'): Promise<boolean> {
  const redis = getRedisClient();

  // Try Redis first if available
  if (redis) {
    try {
      return await checkRateLimitRedis(ip, tier);
    } catch (error) {
      // Fall back to in-memory on Redis error
      logger.error('Redis rate limiting failed, using in-memory fallback', { error, ip, tier });
    }
  }

  // Fall back to in-memory store
  return checkRateLimitMemory(ip, tier);
}

/**
 * Get remaining requests for an IP
 * @param ip - IP address
 * @param tier - Rate limit tier (defaults to 'anonymous')
 */
export function getRemainingRequests(ip: string, tier: RateLimitTier = 'anonymous'): number {
  const tierConfig = RATE_LIMIT_TIERS[tier];
  const key = `${tier}:${ip}`;
  const entry = rateLimitStore.get(key);
  if (!entry || entry.resetTime < Date.now()) {
    return tierConfig.max;
  }
  return Math.max(0, tierConfig.max - entry.count);
}

/**
 * Get rate limit information for an IP
 * Returns limit, remaining, and reset time
 * @param ip - IP address
 * @param tier - Rate limit tier (defaults to 'anonymous')
 */
export function getRateLimitInfo(ip: string, tier: RateLimitTier = 'anonymous'): {
  limit: number;
  remaining: number;
  reset: number;
} {
  const tierConfig = RATE_LIMIT_TIERS[tier];
  const key = `${tier}:${ip}`;
  const entry = rateLimitStore.get(key);
  const now = Date.now();

  if (!entry || entry.resetTime < now) {
    return {
      limit: tierConfig.max,
      remaining: tierConfig.max,
      reset: now + tierConfig.window,
    };
  }

  return {
    limit: tierConfig.max,
    remaining: Math.max(0, tierConfig.max - entry.count),
    reset: entry.resetTime,
  };
}

/**
 * Operation-specific rate limit entry
 */
interface OperationRateLimitEntry {
  count: number;
  resetTime: number;
}

const operationRateLimitStore = new Map<string, OperationRateLimitEntry>();

/**
 * Clear all rate limit stores (useful for testing or server restart)
 */
export function clearRateLimitStores(): void {
  rateLimitStore.clear();
  operationRateLimitStore.clear();
  logger.info('Rate limit stores cleared');
}

/**
 * Check operation-specific rate limit using Redis
 */
async function checkOperationRateLimitRedis(
  ip: string,
  operation: string,
  limit: number,
  windowMs: number
): Promise<{ exceeded: boolean; remaining: number; reset: number }> {
  const redis = getRedisClient();
  if (!redis) {
    return { exceeded: false, remaining: limit, reset: Date.now() + windowMs };
  }

  try {
    const key = `rate_limit:${operation}:${ip}`;
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.pexpire(key, windowMs);
    }

    const exceeded = count > limit;
    const remaining = Math.max(0, limit - count);
    const ttl = await redis.pttl(key);
    const reset = ttl > 0 ? Date.now() + ttl : Date.now() + windowMs;

    return { exceeded, remaining, reset };
  } catch (error) {
    logger.error('Redis operation rate limit check failed, falling back to in-memory', {
      error: error instanceof Error ? error.message : String(error),
      ip,
      operation,
    });
    return checkOperationRateLimitMemory(ip, operation, limit, windowMs);
  }
}

/**
 * Check operation-specific rate limit using in-memory store
 */
function checkOperationRateLimitMemory(
  ip: string,
  operation: string,
  limit: number,
  windowMs: number
): { exceeded: boolean; remaining: number; reset: number } {
  const now = Date.now();
  const key = `${operation}:${ip}`;
  const entry = operationRateLimitStore.get(key);

  if (!entry || entry.resetTime < now) {
    const newEntry: OperationRateLimitEntry = {
      count: 1,
      resetTime: now + windowMs,
    };
    operationRateLimitStore.set(key, newEntry);
    return {
      exceeded: false,
      remaining: limit - 1,
      reset: newEntry.resetTime,
    };
  }

  entry.count += 1;
  const exceeded = entry.count > limit;
  const remaining = Math.max(0, limit - entry.count);

  return {
    exceeded,
    remaining,
    reset: entry.resetTime,
  };
}

/**
 * Check operation-specific rate limit
 */
export async function checkOperationRateLimit(
  ip: string,
  operation: string,
  limit: number,
  windowMs: number = WINDOW_MS
): Promise<{ exceeded: boolean; remaining: number; reset: number }> {
  const redis = getRedisClient();
  if (redis) {
    try {
      return await checkOperationRateLimitRedis(ip, operation, limit, windowMs);
    } catch (error) {
      logger.error('Redis operation rate limiting failed, using in-memory fallback', {
        error,
        ip,
        operation,
      });
    }
  }

  return checkOperationRateLimitMemory(ip, operation, limit, windowMs);
}

/**
 * Operation-specific rate limit functions
 */
export async function checkStartDialogueRateLimit(ip: string) {
  return checkOperationRateLimit(ip, 'start-dialogue', RATE_LIMIT_CONFIG.START_DIALOGUE);
}

export async function checkProceedDialogueRateLimit(ip: string) {
  return checkOperationRateLimit(ip, 'proceed-dialogue', RATE_LIMIT_CONFIG.PROCEED_DIALOGUE);
}

export async function checkSubmitAnswersRateLimit(ip: string) {
  return checkOperationRateLimit(ip, 'submit-answers', RATE_LIMIT_CONFIG.SUBMIT_ANSWERS);
}

export async function checkGenerateQuestionsRateLimit(ip: string) {
  return checkOperationRateLimit(ip, 'generate-questions', RATE_LIMIT_CONFIG.GENERATE_QUESTIONS);
}

export async function checkGenerateSummaryRateLimit(ip: string) {
  return checkOperationRateLimit(ip, 'generate-summary', RATE_LIMIT_CONFIG.GENERATE_SUMMARY);
}

/**
 * Cleanup expired operation rate limit entries
 */
function cleanupExpiredOperationEntries(): void {
  const now = Date.now();
  const expiredKeys: string[] = [];

  for (const [key, entry] of operationRateLimitStore.entries()) {
    if (entry.resetTime < now) {
      expiredKeys.push(key);
    }
  }

  for (const key of expiredKeys) {
    operationRateLimitStore.delete(key);
  }
}

// Start periodic cleanup every 60 seconds
if (typeof setInterval !== 'undefined') {
  cleanupExpiredOperationEntriesIntervalId = setInterval(cleanupExpiredOperationEntries, 60000);
}

/**
 * Cleanup all rate limit intervals
 * Should be called during graceful shutdown
 */
export function cleanupRateLimitIntervals(): void {
  if (cleanupExpiredEntriesIntervalId !== null) {
    clearInterval(cleanupExpiredEntriesIntervalId);
    cleanupExpiredEntriesIntervalId = null;
  }
  if (cleanupExpiredOperationEntriesIntervalId !== null) {
    clearInterval(cleanupExpiredOperationEntriesIntervalId);
    cleanupExpiredOperationEntriesIntervalId = null;
  }
}
