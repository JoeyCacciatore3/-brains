/**
 * Processing lock mechanism to prevent concurrent round processing
 * Uses Redis for distributed locking with in-memory fallback
 */

import { getRedisClient } from '@/lib/db/redis';
import { logger } from '@/lib/logger';

const PROCESSING_LOCK_PREFIX = 'processing:';
const PROCESSING_LOCK_TTL = 300000; // 5 minutes (longer than file lock for processing)

// In-memory processing locks (fallback when Redis unavailable)
const inMemoryProcessingLocks = new Map<string, { expiresAt: number; lockId: string }>();

/**
 * Generate unique lock ID
 */
function generateProcessingLockId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Acquire processing lock for a discussion
 * Returns lock ID if acquired, null if already processing
 */
export async function acquireProcessingLock(
  discussionId: string,
  userId: string
): Promise<string | null> {
  const lockKey = `${PROCESSING_LOCK_PREFIX}${userId}:${discussionId}`;
  const lockId = generateProcessingLockId();
  const expiresAt = Date.now() + PROCESSING_LOCK_TTL;

  const redis = getRedisClient();

  // Try Redis first
  if (redis) {
    try {
      const result = await redis.set(lockKey, lockId, 'PX', PROCESSING_LOCK_TTL, 'NX');
      if (result === 'OK') {
        logger.debug('Acquired Redis processing lock', { discussionId, userId, lockId });
        return lockId;
      }
      // Lock already exists
      logger.debug('Failed to acquire Redis processing lock (already processing)', {
        discussionId,
        userId,
      });
      return null;
    } catch (error) {
      logger.warn('Redis processing lock acquisition failed, falling back to in-memory', {
        discussionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to in-memory
    }
  }

  // Fallback to in-memory locking
  const existingLock = inMemoryProcessingLocks.get(lockKey);
  if (existingLock) {
    // Check if lock has expired
    if (existingLock.expiresAt > Date.now()) {
      logger.debug('Failed to acquire in-memory processing lock (already processing)', {
        discussionId,
        userId,
      });
      return null;
    }
    // Lock expired, remove it
    inMemoryProcessingLocks.delete(lockKey);
  }

  // Acquire in-memory lock
  inMemoryProcessingLocks.set(lockKey, { expiresAt, lockId });
  logger.debug('Acquired in-memory processing lock', { discussionId, userId, lockId });

  // Schedule cleanup for expired locks
  setTimeout(() => {
    const lock = inMemoryProcessingLocks.get(lockKey);
    if (lock && lock.expiresAt <= Date.now()) {
      inMemoryProcessingLocks.delete(lockKey);
    }
  }, PROCESSING_LOCK_TTL);

  return lockId;
}

/**
 * Release processing lock
 */
export async function releaseProcessingLock(
  discussionId: string,
  userId: string,
  lockId: string
): Promise<void> {
  const lockKey = `${PROCESSING_LOCK_PREFIX}${userId}:${discussionId}`;

  const redis = getRedisClient();

  // Try Redis first
  if (redis) {
    try {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await redis.eval(script, 1, lockKey, lockId);
      logger.debug('Released Redis processing lock', { discussionId, userId, lockId });
      return;
    } catch (error) {
      logger.warn('Redis processing lock release failed, falling back to in-memory', {
        discussionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to in-memory
    }
  }

  // Fallback to in-memory
  const existingLock = inMemoryProcessingLocks.get(lockKey);
  if (existingLock && existingLock.lockId === lockId) {
    inMemoryProcessingLocks.delete(lockKey);
    logger.debug('Released in-memory processing lock', { discussionId, userId, lockId });
  } else {
    logger.warn('Attempted to release processing lock with wrong lockId or lock not found', {
      discussionId,
      userId,
      lockId,
      existingLockId: existingLock?.lockId,
    });
  }
}

/**
 * Execute function with processing lock
 * Returns error if discussion is already processing
 */
export async function withProcessingLock<T>(
  discussionId: string,
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockId = await acquireProcessingLock(discussionId, userId);
  if (!lockId) {
    throw new Error(
      `Discussion ${discussionId} is already being processed. Please wait for the current operation to complete.`
    );
  }

  try {
    return await fn();
  } finally {
    await releaseProcessingLock(discussionId, userId, lockId);
  }
}

/**
 * Check if discussion is currently being processed
 */
export async function isProcessing(discussionId: string, userId: string): Promise<boolean> {
  const lockId = await acquireProcessingLock(discussionId, userId);
  if (lockId) {
    // Immediately release since we were just checking
    await releaseProcessingLock(discussionId, userId, lockId);
    return false;
  }
  return true;
}
