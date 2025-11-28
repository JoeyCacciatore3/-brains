/**
 * Reconciliation mechanism to sync database from files
 * Detects and repairs file-database inconsistencies
 */

import { logger } from '@/lib/logger';
import { readDiscussion, getUserDiscussionIds } from './file-manager';
import { getDiscussion, updateDiscussion, getAllDiscussions } from '@/lib/db/discussions';
import { calculateDiscussionTokenCount } from './token-counter';

interface ReconciliationResult {
  discussionId: string;
  userId: string;
  status: 'synced' | 'repaired' | 'error';
  issues: string[];
  fixes: string[];
}

/**
 * Reconcile a single discussion (sync database from file)
 */
export async function reconcileDiscussion(
  discussionId: string,
  userId: string
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    discussionId,
    userId,
    status: 'synced',
    issues: [],
    fixes: [],
  };

  try {
    // Read from file (source of truth)
    const fileData = await readDiscussion(discussionId, userId);

    // Get database record
    const dbRecord = getDiscussion(discussionId, userId);

    if (!dbRecord) {
      result.issues.push('Discussion not found in database');
      result.status = 'error';
      return result;
    }

    // Calculate token count from file using centralized function
    // Option A: Database stores full context token count including overhead (matches loadDiscussionContext)
    const tokenCount = calculateDiscussionTokenCount(fileData, {
      includeSystemPrompts: true,
      includeFormattingOverhead: true,
    });

    // Check for inconsistencies
    const updates: Partial<{
      token_count: number;
      summary: string | null;
      summary_created_at: number | null;
      is_resolved: number;
      current_turn: number;
    }> = {};

    // Check token count
    if (dbRecord.token_count !== tokenCount) {
      result.issues.push(`Token count mismatch: DB=${dbRecord.token_count}, File=${tokenCount}`);
      updates.token_count = tokenCount;
      result.fixes.push(`Updated token_count from ${dbRecord.token_count} to ${tokenCount}`);
    }

    // Check summary
    const fileSummary = fileData.currentSummary?.summary || fileData.summary || null;
    const dbSummary = dbRecord.summary || null;
    if (fileSummary !== dbSummary) {
      result.issues.push('Summary mismatch between file and database');
      updates.summary = fileSummary;
      if (fileData.currentSummary) {
        updates.summary_created_at = fileData.currentSummary.createdAt;
      }
      result.fixes.push('Updated summary from file');
    }

    // Check resolution status
    // Note: Resolution is determined by resolver, but we can check if discussion has reached max turns
    // This is a simplified check - actual resolution detection is more complex
    const currentRound = fileData.currentRound || 0;
    if (dbRecord.current_turn !== currentRound) {
      result.issues.push(`Current turn mismatch: DB=${dbRecord.current_turn}, File=${currentRound}`);
      updates.current_turn = currentRound;
      result.fixes.push(`Updated current_turn from ${dbRecord.current_turn} to ${currentRound}`);
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      updateDiscussion(discussionId, {
        token_count: updates.token_count,
        summary: updates.summary || undefined,
        summary_created_at: updates.summary_created_at || undefined,
        current_turn: updates.current_turn,
      });
      result.status = 'repaired';
      logger.info('Reconciled discussion', {
        discussionId,
        userId,
        fixes: result.fixes,
      });
    } else {
      logger.debug('Discussion is in sync', { discussionId, userId });
    }

    return result;
  } catch (error) {
    result.status = 'error';
    result.issues.push(
      `Error during reconciliation: ${error instanceof Error ? error.message : String(error)}`
    );
    logger.error('Failed to reconcile discussion', {
      discussionId,
      userId,
      error,
    });
    return result;
  }
}

/**
 * Reconcile all discussions for a user
 */
export async function reconcileUserDiscussions(userId: string): Promise<ReconciliationResult[]> {
  const results: ReconciliationResult[] = [];

  try {
    const discussionIds = await getUserDiscussionIds(userId);

    for (const discussionId of discussionIds) {
      const result = await reconcileDiscussion(discussionId, userId);
      results.push(result);
    }

    const synced = results.filter((r) => r.status === 'synced').length;
    const repaired = results.filter((r) => r.status === 'repaired').length;
    const errors = results.filter((r) => r.status === 'error').length;

    logger.info('Reconciled user discussions', {
      userId,
      total: results.length,
      synced,
      repaired,
      errors,
    });

    return results;
  } catch (error) {
    logger.error('Failed to reconcile user discussions', { userId, error });
    throw error;
  }
}

/**
 * Reconcile all discussions (all users)
 * Note: This can be resource-intensive, use with caution
 */
export async function reconcileAllDiscussions(): Promise<{
  total: number;
  synced: number;
  repaired: number;
  errors: number;
  results: ReconciliationResult[];
}> {
  const results: ReconciliationResult[] = [];

  try {
    // Get all discussions from database
    const allDiscussions = getAllDiscussions();

    // Group by userId
    const discussionsByUser = new Map<string, Array<{ id: string }>>();
    for (const discussion of allDiscussions) {
      if (!discussionsByUser.has(discussion.user_id)) {
        discussionsByUser.set(discussion.user_id, []);
      }
      discussionsByUser.get(discussion.user_id)!.push({ id: discussion.id });
    }

    // Reconcile each user's discussions
    for (const [userId, discussions] of discussionsByUser.entries()) {
      for (const discussion of discussions) {
        const result = await reconcileDiscussion(discussion.id, userId);
        results.push(result);
      }
    }

    const synced = results.filter((r) => r.status === 'synced').length;
    const repaired = results.filter((r) => r.status === 'repaired').length;
    const errors = results.filter((r) => r.status === 'error').length;

    logger.info('Reconciled all discussions', {
      total: results.length,
      synced,
      repaired,
      errors,
    });

    return {
      total: results.length,
      synced,
      repaired,
      errors,
      results,
    };
  } catch (error) {
    logger.error('Failed to reconcile all discussions', { error });
    throw error;
  }
}

/**
 * Validate token count sync between file and database
 * Returns true if in sync, false if mismatch detected
 * Optionally auto-repairs if mismatch is small (< 5% difference)
 */
export async function validateTokenCountSync(
  discussionId: string,
  userId: string,
  options?: { autoRepair?: boolean; tolerancePercent?: number }
): Promise<{
  inSync: boolean;
  fileTokenCount: number;
  dbTokenCount: number;
  difference: number;
  differencePercent: number;
  repaired?: boolean;
}> {
  const autoRepair = options?.autoRepair ?? false;
  const tolerancePercent = options?.tolerancePercent ?? 5;

  try {
    // Read from file (source of truth)
    const fileData = await readDiscussion(discussionId, userId);
    const dbRecord = getDiscussion(discussionId, userId);

    if (!dbRecord) {
      throw new Error('Discussion not found in database');
    }

    // Calculate token count from file using centralized function
    // Option A: Database stores full context token count including overhead (matches loadDiscussionContext)
    const fileTokenCount = calculateDiscussionTokenCount(fileData, {
      includeSystemPrompts: true,
      includeFormattingOverhead: true,
    });

    const dbTokenCount = dbRecord.token_count;
    const difference = Math.abs(fileTokenCount - dbTokenCount);
    const differencePercent =
      dbTokenCount > 0 ? (difference / dbTokenCount) * 100 : fileTokenCount > 0 ? 100 : 0;

    const inSync = differencePercent < tolerancePercent;

    let repaired = false;
    if (!inSync && autoRepair) {
      // Auto-repair if mismatch is small
      updateDiscussion(discussionId, {
        token_count: fileTokenCount,
      });
      repaired = true;
      logger.info('Auto-repaired token count sync', {
        discussionId,
        userId,
        oldTokenCount: dbTokenCount,
        newTokenCount: fileTokenCount,
        difference,
        differencePercent,
      });
    } else if (!inSync) {
      logger.warn('Token count sync mismatch detected', {
        discussionId,
        userId,
        fileTokenCount,
        dbTokenCount,
        difference,
        differencePercent,
        autoRepairEnabled: autoRepair,
      });
    }

    return {
      inSync,
      fileTokenCount,
      dbTokenCount,
      difference,
      differencePercent,
      repaired: repaired || undefined,
    };
  } catch (error) {
    logger.error('Failed to validate token count sync', {
      discussionId,
      userId,
      error,
    });
    throw error;
  }
}

/**
 * Health check to detect file-database inconsistencies
 * Returns summary of inconsistencies found
 */
export async function healthCheck(userId?: string): Promise<{
  healthy: boolean;
  inconsistencies: number;
  details: ReconciliationResult[];
}> {
  const results = userId
    ? await reconcileUserDiscussions(userId)
    : (await reconcileAllDiscussions()).results;

  const inconsistencies = results.filter((r) => r.status !== 'synced').length;

  return {
    healthy: inconsistencies === 0,
    inconsistencies,
    details: results.filter((r) => r.status !== 'synced'),
  };
}
