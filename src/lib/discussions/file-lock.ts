/**
 * File locking mechanism for concurrent file operations
 * Uses Redis for distributed locking with in-memory fallback
 */

import { getRedisClient } from '@/lib/db/redis';
import { logger } from '@/lib/logger';

const LOCK_PREFIX = 'file-lock:';
const DEFAULT_LOCK_TTL = 30000; // 30 seconds
const LOCK_RETRY_DELAY = 100; // 100ms
const MAX_LOCK_RETRIES = 50; // 5 seconds total

// In-memory lock store for fallback when Redis unavailable
const inMemoryLocks = new Map<string, { expiresAt: number; lockId: string }>();

/**
 * Generate unique lock ID
 */
function generateLockId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Acquire a lock for a discussion file
 * @param discussionId - Discussion ID to lock
 * @param userId - User ID (for namespacing)
 * @param ttl - Lock TTL in milliseconds (default: 30 seconds)
 * @returns Lock ID if acquired, null if failed
 */
export async function acquireLock(
  discussionId: string,
  userId: string,
  ttl: number = DEFAULT_LOCK_TTL
): Promise<string | null> {
  const lockKey = `${LOCK_PREFIX}${userId}:${discussionId}`;
  const lockId = generateLockId();
  const expiresAt = Date.now() + ttl;

  const redis = getRedisClient();

  // Try Redis first
  if (redis) {
    try {
      // Use SET with NX (only if not exists) and EX (expiration)
      const result = await redis.set(lockKey, lockId, 'PX', ttl, 'NX');
      if (result === 'OK') {
        logger.debug('Acquired Redis lock', { discussionId, userId, lockId, ttl });
        return lockId;
      }
      // Lock already exists
      logger.debug('Failed to acquire Redis lock (already locked)', { discussionId, userId });
    } catch (error) {
      logger.warn('Redis lock acquisition failed, falling back to in-memory', {
        discussionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to in-memory
    }
  }

  // Fallback to in-memory locking
  const existingLock = inMemoryLocks.get(lockKey);
  if (existingLock) {
    // Check if lock has expired
    if (existingLock.expiresAt > Date.now()) {
      logger.debug('Failed to acquire in-memory lock (already locked)', { discussionId, userId });
      return null;
    }
    // Lock expired, remove it
    inMemoryLocks.delete(lockKey);
  }

  // Acquire in-memory lock
  inMemoryLocks.set(lockKey, { expiresAt, lockId });
  logger.debug('Acquired in-memory lock', { discussionId, userId, lockId, ttl });

  // Schedule cleanup for expired locks
  setTimeout(() => {
    const lock = inMemoryLocks.get(lockKey);
    if (lock && lock.expiresAt <= Date.now()) {
      inMemoryLocks.delete(lockKey);
    }
  }, ttl);

  return lockId;
}

/**
 * Release a lock
 * @param discussionId - Discussion ID
 * @param userId - User ID
 * @param lockId - Lock ID to release
 */
export async function releaseLock(
  discussionId: string,
  userId: string,
  lockId: string
): Promise<void> {
  const lockKey = `${LOCK_PREFIX}${userId}:${discussionId}`;

  const redis = getRedisClient();

  // Try Redis first
  if (redis) {
    try {
      // Use Lua script to ensure we only delete our own lock
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await redis.eval(script, 1, lockKey, lockId);
      logger.debug('Released Redis lock', { discussionId, userId, lockId });
      return;
    } catch (error) {
      logger.warn('Redis lock release failed, falling back to in-memory', {
        discussionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to in-memory
    }
  }

  // Fallback to in-memory
  const existingLock = inMemoryLocks.get(lockKey);
  if (existingLock && existingLock.lockId === lockId) {
    inMemoryLocks.delete(lockKey);
    logger.debug('Released in-memory lock', { discussionId, userId, lockId });
  } else {
    logger.warn('Attempted to release lock with wrong lockId or lock not found', {
      discussionId,
      userId,
      lockId,
      existingLockId: existingLock?.lockId,
    });
  }
}

/**
 * Acquire lock with retry
 * @param discussionId - Discussion ID
 * @param userId - User ID
 * @param ttl - Lock TTL
 * @param maxRetries - Maximum retry attempts
 * @returns Lock ID
 * @throws Error if lock cannot be acquired
 */
export async function acquireLockWithRetry(
  discussionId: string,
  userId: string,
  ttl: number = DEFAULT_LOCK_TTL,
  maxRetries: number = MAX_LOCK_RETRIES
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const lockId = await acquireLock(discussionId, userId, ttl);
    if (lockId) {
      return lockId;
    }

    // Wait before retrying
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY));
    }
  }

  throw new Error(
    `Failed to acquire lock for discussion ${discussionId} after ${maxRetries} attempts`
  );
}

/**
 * Execute a function with a file lock
 * @param discussionId - Discussion ID
 * @param userId - User ID
 * @param fn - Function to execute
 * @param ttl - Lock TTL
 * @returns Result of function execution
 */
export async function withLock<T>(
  discussionId: string,
  userId: string,
  fn: () => Promise<T>,
  ttl: number = DEFAULT_LOCK_TTL
): Promise<T> {
  const lockId = await acquireLockWithRetry(discussionId, userId, ttl);
  try {
    return await fn();
  } finally {
    await releaseLock(discussionId, userId, lockId);
  }
}

/**
 * Cleanup expired in-memory locks (should be called periodically)
 */
export function cleanupExpiredLocks(): void {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, lock] of inMemoryLocks.entries()) {
    if (lock.expiresAt <= now) {
      inMemoryLocks.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug('Cleaned up expired in-memory locks', { count: cleaned });
  }
}

// Cleanup expired locks every minute
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredLocks, 60000);
}
