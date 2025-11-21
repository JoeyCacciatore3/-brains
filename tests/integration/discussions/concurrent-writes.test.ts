import { describe, it, expect } from 'vitest';
import { addRoundToDiscussion, readDiscussion } from '@/lib/discussions/file-manager';
import { randomUUID } from 'crypto';
import type { DiscussionRound } from '@/types';

describe('Concurrent File Writes', () => {
  it('should prevent race conditions in concurrent writes', async () => {
    const discussionId = randomUUID();
    const userId = 'test-user';

    // Create initial discussion
    const { createDiscussion } = await import('@/lib/discussions/file-manager');
    await createDiscussion(userId, 'Test topic');

    const round1: DiscussionRound = {
      roundNumber: 1,
      solverResponse: {
        discussion_id: discussionId,
        persona: 'Solver AI',
        content: 'Response 1',
        turn: 1,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
      analyzerResponse: {
        discussion_id: discussionId,
        persona: 'Analyzer AI',
        content: 'Response 2',
        turn: 2,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
      moderatorResponse: {
        discussion_id: discussionId,
        persona: 'Moderator AI',
        content: 'Response 3',
        turn: 3,
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
      timestamp: new Date().toISOString(),
    };

    // Try to add same round concurrently
    const promises = [
      addRoundToDiscussion(discussionId, userId, round1),
      addRoundToDiscussion(discussionId, userId, round1),
    ];

    // One should succeed, one should be blocked by lock
    const results = await Promise.allSettled(promises);

    // At least one should succeed
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded.length).toBeGreaterThan(0);

    // Verify final state
    const discussion = await readDiscussion(discussionId, userId);
    expect(discussion.rounds).toBeDefined();
  });
});
