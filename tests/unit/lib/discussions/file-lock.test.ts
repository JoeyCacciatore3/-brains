import { describe, it, expect, beforeEach } from 'vitest';
import {
  acquireLock,
  releaseLock,
  withLock,
  cleanupExpiredLocks,
} from '@/lib/discussions/file-lock';

describe('File Lock', () => {
  const discussionId = 'test-discussion-id';
  const userId = 'test-user-id';

  beforeEach(() => {
    // Clean up any existing locks
    cleanupExpiredLocks();
  });

  it('should acquire and release lock', async () => {
    const lockId = await acquireLock(discussionId, userId);
    expect(lockId).toBeTruthy();

    const lockId2 = await acquireLock(discussionId, userId);
    expect(lockId2).toBeNull(); // Should fail - already locked

    await releaseLock(discussionId, userId, lockId!);

    const lockId3 = await acquireLock(discussionId, userId);
    expect(lockId3).toBeTruthy(); // Should succeed after release
  });

  it('should execute function with lock', async () => {
    let executed = false;
    await withLock(discussionId, userId, async () => {
      executed = true;
    });

    expect(executed).toBe(true);
  });

  it('should prevent concurrent execution', async () => {
    let executionCount = 0;

    const promise1 = withLock(discussionId, userId, async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      executionCount++;
    });

    const lockId = await acquireLock(discussionId, userId);
    expect(lockId).toBeNull(); // Should fail - already locked by withLock

    await promise1;
    expect(executionCount).toBe(1);
  });
});
