import { getRedisClient } from './db/redis';
import { logger } from './logger';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10', 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);

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

// Start periodic cleanup every 60 seconds
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredEntries, 60000);
}

/**
 * Check rate limit using Redis (distributed rate limiting)
 * @param ip - IP address to check
 * @returns Promise<boolean> - true if rate limit exceeded, false otherwise
 */
async function checkRateLimitRedis(ip: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    return false; // Fall back to in-memory if Redis unavailable
  }

  try {
    const key = `rate_limit:${ip}`;

    // Get current count
    const count = await redis.incr(key);

    // Set TTL on first request (when count is 1)
    if (count === 1) {
      await redis.pexpire(key, WINDOW_MS);
    }

    // Check if limit exceeded
    if (count > MAX_REQUESTS) {
      return true; // Rate limit exceeded
    }

    return false;
  } catch (error) {
    // If Redis fails, ALWAYS fall back to in-memory (never return false - security risk)
    logger.error('Redis rate limit check failed, falling back to in-memory', {
      error: error instanceof Error ? error.message : String(error),
      ip,
    });
    // Use in-memory fallback instead of returning false
    return checkRateLimitMemory(ip);
  }
}

/**
 * Check rate limit using in-memory store (fallback)
 * @param ip - IP address to check
 * @returns boolean - true if rate limit exceeded, false otherwise
 */
function checkRateLimitMemory(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || entry.resetTime < now) {
    // Create new entry or reset expired one
    rateLimitStore.set(ip, {
      count: 1,
      resetTime: now + WINDOW_MS,
    });
    return false;
  }

  if (entry.count >= MAX_REQUESTS) {
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
 * @returns Promise<boolean> - true if rate limit is exceeded, false otherwise
 */
export async function checkRateLimit(ip: string): Promise<boolean> {
  const redis = getRedisClient();

  // Try Redis first if available
  if (redis) {
    try {
      return await checkRateLimitRedis(ip);
    } catch (error) {
      // Fall back to in-memory on Redis error
      logger.error('Redis rate limiting failed, using in-memory fallback', { error, ip });
    }
  }

  // Fall back to in-memory store
  return checkRateLimitMemory(ip);
}

/**
 * Get remaining requests for an IP
 */
export function getRemainingRequests(ip: string): number {
  const entry = rateLimitStore.get(ip);
  if (!entry || entry.resetTime < Date.now()) {
    return MAX_REQUESTS;
  }
  return Math.max(0, MAX_REQUESTS - entry.count);
}

/**
 * Get rate limit information for an IP
 * Returns limit, remaining, and reset time
 */
export function getRateLimitInfo(ip: string): {
  limit: number;
  remaining: number;
  reset: number;
} {
  const entry = rateLimitStore.get(ip);
  const now = Date.now();

  if (!entry || entry.resetTime < now) {
    return {
      limit: MAX_REQUESTS,
      remaining: MAX_REQUESTS,
      reset: now + WINDOW_MS,
    };
  }

  return {
    limit: MAX_REQUESTS,
    remaining: Math.max(0, MAX_REQUESTS - entry.count),
    reset: entry.resetTime,
  };
}
