/**
 * Reconciliation mechanism to sync database from files
 * Detects and repairs file-database inconsistencies
 */

import { logger } from '@/lib/logger';
import { readDiscussion, getUserDiscussionIds } from './file-manager';
import { getDiscussion, updateDiscussion, getAllDiscussions } from '@/lib/db/discussions';
import { countTokens } from './token-counter';

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
    const dbRecord = getDiscussion(discussionId);

    if (!dbRecord) {
      result.issues.push('Discussion not found in database');
      result.status = 'error';
      return result;
    }

    // Calculate token count from file
    let tokenCount = 0;
    if (fileData.currentSummary) {
      tokenCount += countTokens(fileData.currentSummary.summary);
      if (fileData.rounds) {
        const summaryRound = fileData.currentSummary.roundNumber;
        const roundsAfterSummary = fileData.rounds.filter((r) => r.roundNumber > summaryRound);
        tokenCount += roundsAfterSummary.reduce((sum, round) => {
          return (
            sum +
            countTokens(round.solverResponse.content) +
            countTokens(round.analyzerResponse.content)
          );
        }, 0);
      }
    } else if (fileData.rounds && fileData.rounds.length > 0) {
      tokenCount = fileData.rounds.reduce((sum, round) => {
        return (
          sum +
          countTokens(round.solverResponse.content) +
          countTokens(round.analyzerResponse.content)
        );
      }, 0);
    }

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
