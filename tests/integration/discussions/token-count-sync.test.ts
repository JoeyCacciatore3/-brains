import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDiscussion as createDiscussionFiles, readDiscussion } from '@/lib/discussions/file-manager';
import { createDiscussion, getDiscussion, syncTokenCountFromFile } from '@/lib/db/discussions';
import { initializeDatabase, closeDatabase } from '@/lib/db';
import { calculateDiscussionTokenCount } from '@/lib/discussions/token-counter';
import { loadDiscussionContext } from '@/lib/discussion-context';
import { addRoundToDiscussion } from '@/lib/discussions/file-manager';
import { createMockDiscussionRound } from '../../utils/test-fixtures';

describe('Token Count Sync Integration', () => {
  const testUserId = 'test-user-token-sync';

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

  it('should sync token count from file to database consistently', async () => {
    // Create discussion
    const fileResult = await createDiscussionFiles(testUserId, 'Test topic for token sync');
    const _discussion = createDiscussion(
      testUserId,
      'Test topic for token sync',
      fileResult.jsonPath,
      fileResult.mdPath,
      fileResult.id
    );

    // Add a round
    const round = createMockDiscussionRound(1, 'Solver response', 'Analyzer response', 'Moderator response');
    await addRoundToDiscussion(fileResult.id, testUserId, round);

    // Load context (includes overhead)
    const context = await loadDiscussionContext(fileResult.id, testUserId);

    // Sync to database using centralized function
    const discussionData = await readDiscussion(fileResult.id, testUserId);
    const calculatedTokenCount = calculateDiscussionTokenCount(discussionData, {
      includeSystemPrompts: true,
      includeFormattingOverhead: true,
    });

    syncTokenCountFromFile(fileResult.id, calculatedTokenCount);

    // Verify database matches
    const dbRecord = getDiscussion(fileResult.id, testUserId);
    expect(dbRecord).toBeDefined();
    expect(dbRecord!.token_count).toBe(calculatedTokenCount);
    expect(dbRecord!.token_count).toBe(context.tokenCount);

    // Verify context tokenCount matches calculated count
    expect(context.tokenCount).toBe(calculatedTokenCount);
  });

  it('should maintain consistency across multiple rounds', async () => {
    const fileResult = await createDiscussionFiles(testUserId, 'Multi-round test');
    createDiscussion(testUserId, 'Multi-round test', fileResult.jsonPath, fileResult.mdPath, fileResult.id);

    // Add multiple rounds
    for (let i = 1; i <= 3; i++) {
      const round = createMockDiscussionRound(i, `Solver ${i}`, `Analyzer ${i}`, `Moderator ${i}`);
      await addRoundToDiscussion(fileResult.id, testUserId, round);

      // Sync after each round
      const discussionData = await readDiscussion(fileResult.id, testUserId);
      const tokenCount = calculateDiscussionTokenCount(discussionData, {
        includeSystemPrompts: true,
        includeFormattingOverhead: true,
      });
      syncTokenCountFromFile(fileResult.id, tokenCount);

      // Verify consistency
      const context = await loadDiscussionContext(fileResult.id, testUserId);
      const dbRecord = getDiscussion(fileResult.id, testUserId);

      expect(context.tokenCount).toBe(tokenCount);
      expect(dbRecord!.token_count).toBe(tokenCount);
      expect(dbRecord!.token_count).toBe(context.tokenCount);
    }
  });
});
