import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDiscussion as createDiscussionFiles, readDiscussion } from '@/lib/discussions/file-manager';
import { createDiscussion, getDiscussion } from '@/lib/db/discussions';
import { initializeDatabase, closeDatabase } from '@/lib/db';
import { reconcileDiscussion, validateTokenCountSync } from '@/lib/discussions/reconciliation';
import { calculateDiscussionTokenCount } from '@/lib/discussions/token-counter';
import { createMockDiscussionRound } from '@/tests/utils/test-fixtures';
import { addRoundToDiscussion } from '@/lib/discussions/file-manager';

describe('Reconciliation Token Count Consistency', () => {
  const testUserId = 'test-user-reconciliation';

  beforeEach(() => {
    try {
      initializeDatabase();
    } catch (error) {
      // Database may already be initialized
    }
  });

  afterEach(() => {
    try {
      closeDatabase();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should reconcile token counts correctly using centralized function', async () => {
    // Create discussion
    const fileResult = await createDiscussionFiles(testUserId, 'Reconciliation test topic');
    createDiscussion(testUserId, 'Reconciliation test topic', fileResult.jsonPath, fileResult.mdPath, fileResult.id);

    // Add rounds
    await addRoundToDiscussion(
      fileResult.id,
      testUserId,
      createMockDiscussionRound(1, 'Solver 1', 'Analyzer 1', 'Moderator 1')
    );
    await addRoundToDiscussion(
      fileResult.id,
      testUserId,
      createMockDiscussionRound(2, 'Solver 2', 'Analyzer 2', 'Moderator 2')
    );

    // Reconcile
    const result = await reconcileDiscussion(fileResult.id, testUserId);

    expect(result.status).toBe('synced' || 'repaired');

    // Verify database matches file calculation
    const discussionData = await readDiscussion(fileResult.id, testUserId);
    const calculatedTokenCount = calculateDiscussionTokenCount(discussionData, {
      includeSystemPrompts: true,
      includeFormattingOverhead: true,
    });

    const dbRecord = getDiscussion(fileResult.id, testUserId);
    expect(dbRecord!.token_count).toBe(calculatedTokenCount);
  });

  it('should validate token count sync correctly', async () => {
    const fileResult = await createDiscussionFiles(testUserId, 'Validation test');
    createDiscussion(testUserId, 'Validation test', fileResult.jsonPath, fileResult.mdPath, fileResult.id);

    await addRoundToDiscussion(
      fileResult.id,
      testUserId,
      createMockDiscussionRound(1, 'Content', 'Content', 'Content')
    );

    const syncResult = await validateTokenCountSync(fileResult.id, testUserId, {
      autoRepair: false,
      tolerancePercent: 5,
    });

    expect(syncResult.inSync).toBe(true);
    expect(syncResult.fileTokenCount).toBe(syncResult.dbTokenCount);

    // Verify both use centralized calculation
    const discussionData = await readDiscussion(fileResult.id, testUserId);
    const calculatedCount = calculateDiscussionTokenCount(discussionData, {
      includeSystemPrompts: true,
      includeFormattingOverhead: true,
    });

    expect(syncResult.fileTokenCount).toBe(calculatedCount);
  });
});
