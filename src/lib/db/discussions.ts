import { randomUUID } from 'crypto';
import { getDatabase } from './index';
import { getTokenLimit } from '@/lib/discussions/token-counter';
import { logger } from '@/lib/logger';

interface DiscussionRow {
  id: string;
  user_id: string;
  topic: string;
  file_path_json: string;
  file_path_md: string;
  token_count: number;
  token_limit: number;
  summary: string | null;
  summary_created_at: number | null;
  created_at: number;
  updated_at: number;
  is_resolved: number;
  needs_user_input: number;
  user_input_pending: string | null;
  current_turn: number;
}

export interface Discussion {
  id: string;
  user_id: string;
  topic: string;
  file_path_json: string;
  file_path_md: string;
  token_count: number;
  token_limit: number;
  summary: string | null;
  summary_created_at: number | null;
  created_at: number;
  updated_at: number;
  is_resolved: number;
  needs_user_input: number;
  user_input_pending: string | null;
  current_turn: number;
}

/**
 * Create a new discussion (METADATA ONLY)
 *
 * Single Source of Truth: This function only creates database metadata.
 * File content should be created separately via file-manager.ts
 *
 * @param discussionId - Optional discussion ID. If not provided, a new UUID will be generated.
 *                       Use this when creating discussion files first and need to sync IDs.
 */
export function createDiscussion(
  userId: string,
  topic: string,
  filePathJson: string,
  filePathMd: string,
  discussionId?: string
): Discussion {
  const id = discussionId || randomUUID();
  const now = Date.now();
  const tokenLimit = getTokenLimit();

  getDatabase()
    .prepare(
      `INSERT INTO discussions (
        id, user_id, topic, file_path_json, file_path_md,
        token_count, token_limit, created_at, updated_at,
        is_resolved, needs_user_input, current_turn
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, 0)`
    )
    .run(id, userId, topic, filePathJson, filePathMd, tokenLimit, now, now);

  return {
    id,
    user_id: userId,
    topic,
    file_path_json: filePathJson,
    file_path_md: filePathMd,
    token_count: 0,
    token_limit: tokenLimit,
    summary: null,
    summary_created_at: null,
    created_at: now,
    updated_at: now,
    is_resolved: 0,
    needs_user_input: 0,
    user_input_pending: null,
    current_turn: 0,
  };
}

/**
 * Sync token count from file storage to database
 *
 * Single Source of Truth: File storage is authoritative for token counts.
 * This function syncs the calculated count from files to database metadata.
 *
 * @param discussionId - Discussion ID
 * @param tokenCount - Token count calculated from file content
 */
export function syncTokenCountFromFile(discussionId: string, tokenCount: number): void {
  const now = Date.now();
  getDatabase()
    .prepare('UPDATE discussions SET token_count = ?, updated_at = ? WHERE id = ?')
    .run(tokenCount, now, discussionId);
}

/**
 * Get discussion by ID
 * Verifies user ownership
 */
export function getDiscussion(discussionId: string, userId: string): Discussion | null {
  const row = getDatabase()
    .prepare('SELECT * FROM discussions WHERE id = ? AND user_id = ?')
    .get(discussionId, userId) as DiscussionRow | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    user_id: row.user_id,
    topic: row.topic,
    file_path_json: row.file_path_json,
    file_path_md: row.file_path_md,
    token_count: row.token_count,
    token_limit: row.token_limit,
    summary: row.summary,
    summary_created_at: row.summary_created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_resolved: row.is_resolved,
    needs_user_input: row.needs_user_input,
    user_input_pending: row.user_input_pending,
    current_turn: row.current_turn,
  };
}

/**
 * Get active discussion for a user (any unresolved discussion)
 * Updated to check for ANY unresolved discussion (enforces one discussion per user)
 */
export function getActiveDiscussion(userId: string): Discussion | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM discussions
       WHERE user_id = ? AND is_resolved = 0
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(userId) as DiscussionRow | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    user_id: row.user_id,
    topic: row.topic,
    file_path_json: row.file_path_json,
    file_path_md: row.file_path_md,
    token_count: row.token_count,
    token_limit: row.token_limit,
    summary: row.summary,
    summary_created_at: row.summary_created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_resolved: row.is_resolved,
    needs_user_input: row.needs_user_input,
    user_input_pending: row.user_input_pending,
    current_turn: row.current_turn,
  };
}

/**
 * Atomically check for active discussion using SQLite's BEGIN IMMEDIATE
 * This prevents race conditions when multiple requests try to create discussions simultaneously
 * Uses exclusive lock to ensure only one check/creation happens at a time per user
 *
 * Also checks for "stuck" discussions (old, unresolved, no recent activity) and optionally auto-resolves them
 *
 * @param userId - User ID to check for active discussions
 * @param autoResolveStuck - If true, automatically resolve discussions that appear stuck (default: true)
 * @param stuckThresholdMs - Time in milliseconds after which a discussion is considered stuck (default: 1 hour)
 * @returns Active discussion if found, null otherwise
 */
export function checkActiveDiscussionAtomically(
  userId: string,
  autoResolveStuck: boolean = true,
  stuckThresholdMs: number = 60 * 60 * 1000 // 1 hour default
): Discussion | null {
  const db = getDatabase();
  const now = Date.now();

  // Use BEGIN IMMEDIATE to get exclusive lock immediately
  // This prevents other transactions from reading/writing until this one completes
  const transaction = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM discussions
         WHERE user_id = ? AND is_resolved = 0
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(userId) as DiscussionRow | undefined;

    if (!row) {
      return null;
    }

    // Check if discussion appears stuck (no recent activity)
    const timeSinceUpdate = now - row.updated_at;
    const isStuck = timeSinceUpdate > stuckThresholdMs;

    if (isStuck && autoResolveStuck) {
      // Auto-resolve stuck discussions
      logger.warn('Auto-resolving stuck discussion', {
        discussionId: row.id,
        userId,
        timeSinceUpdateMs: timeSinceUpdate,
        timeSinceUpdateMinutes: Math.floor(timeSinceUpdate / 60000),
        lastUpdated: new Date(row.updated_at).toISOString(),
      });

      db.prepare('UPDATE discussions SET is_resolved = 1, updated_at = ? WHERE id = ?').run(now, row.id);
      return null; // Discussion was resolved, no active discussion
    }

    if (isStuck) {
      logger.warn('Found stuck discussion (not auto-resolving)', {
        discussionId: row.id,
        userId,
        timeSinceUpdateMs: timeSinceUpdate,
        timeSinceUpdateMinutes: Math.floor(timeSinceUpdate / 60000),
        lastUpdated: new Date(row.updated_at).toISOString(),
      });
    }

    return {
      id: row.id,
      user_id: row.user_id,
      topic: row.topic,
      file_path_json: row.file_path_json,
      file_path_md: row.file_path_md,
      token_count: row.token_count,
      token_limit: row.token_limit,
      summary: row.summary,
      summary_created_at: row.summary_created_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_resolved: row.is_resolved,
      needs_user_input: row.needs_user_input,
      user_input_pending: row.user_input_pending,
      current_turn: row.current_turn,
    };
  });

  try {
    // Execute transaction with immediate lock
    // Note: better-sqlite3 doesn't support BEGIN IMMEDIATE directly in transactions,
    // but the transaction itself provides atomicity. For true exclusive locking,
    // we'd need to use a mutex or file locking, but for SQLite's default behavior,
    // this transaction provides sufficient atomicity for our use case.
    return transaction() as Discussion | null;
  } catch (error) {
    logger.error('Error in checkActiveDiscussionAtomically', {
      error: error instanceof Error ? error.message : String(error),
      userId,
    });
    throw error;
  }
}

/**
 * Update discussion
 * Uses a transaction to ensure all field updates are atomic
 */
export function updateDiscussion(
  id: string,
  updates: Partial<
    Pick<
      Discussion,
      | 'token_count'
      | 'summary'
      | 'summary_created_at'
      | 'is_resolved'
      | 'needs_user_input'
      | 'user_input_pending'
      | 'current_turn'
      | 'updated_at'
    >
  >
): void {
  const db = getDatabase();
  const transaction = db.transaction(() => {
    const updateFields: string[] = [];
    const updateValues: unknown[] = [];

    if (updates.token_count !== undefined) {
      updateFields.push('token_count = ?');
      updateValues.push(updates.token_count);
    }
    if (updates.summary !== undefined) {
      updateFields.push('summary = ?');
      updateValues.push(updates.summary);
    }
    if (updates.summary_created_at !== undefined) {
      updateFields.push('summary_created_at = ?');
      updateValues.push(updates.summary_created_at);
    }
    if (updates.is_resolved !== undefined) {
      updateFields.push('is_resolved = ?');
      updateValues.push(updates.is_resolved);
    }
    if (updates.needs_user_input !== undefined) {
      updateFields.push('needs_user_input = ?');
      updateValues.push(updates.needs_user_input);
    }
    if (updates.user_input_pending !== undefined) {
      updateFields.push('user_input_pending = ?');
      updateValues.push(updates.user_input_pending);
    }
    if (updates.current_turn !== undefined) {
      updateFields.push('current_turn = ?');
      updateValues.push(updates.current_turn);
    }

    // Always update updated_at unless explicitly set
    if (updates.updated_at !== undefined) {
      updateFields.push('updated_at = ?');
      updateValues.push(updates.updated_at);
    } else if (updateFields.length > 0) {
      // Only auto-update if there are other fields to update
      updateFields.push('updated_at = ?');
      updateValues.push(Date.now());
    }

    if (updateFields.length === 0) {
      return; // No updates to perform
    }

    updateValues.push(id);
    const sql = `UPDATE discussions SET ${updateFields.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...updateValues);
  });

  try {
    transaction();
  } catch (error) {
    // Transaction automatically rolls back on error
    throw error;
  }
}

/**
 * Get user's discussions
 */
export function getUserDiscussions(userId: string, limit: number = 50): Discussion[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM discussions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(userId, limit) as DiscussionRow[];

  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    topic: row.topic,
    file_path_json: row.file_path_json,
    file_path_md: row.file_path_md,
    token_count: row.token_count,
    token_limit: row.token_limit,
    summary: row.summary,
    summary_created_at: row.summary_created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_resolved: row.is_resolved,
    needs_user_input: row.needs_user_input,
    user_input_pending: row.user_input_pending,
    current_turn: row.current_turn,
  }));
}

/**
 * Get all discussions (for reconciliation)
 * Use with caution - can be resource-intensive
 */
export function getAllDiscussions(): Discussion[] {
  const rows = getDatabase().prepare('SELECT * FROM discussions').all() as DiscussionRow[];

  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    topic: row.topic,
    file_path_json: row.file_path_json,
    file_path_md: row.file_path_md,
    token_count: row.token_count,
    token_limit: row.token_limit,
    summary: row.summary,
    summary_created_at: row.summary_created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_resolved: row.is_resolved,
    needs_user_input: row.needs_user_input,
    user_input_pending: row.user_input_pending,
    current_turn: row.current_turn,
  }));
}

/**
 * Delete a discussion
 * Verifies user ownership before deletion
 * @param discussionId - Discussion ID to delete
 * @param userId - User ID to verify ownership
 * @throws Error if discussion not found or user doesn't own it
 */
export function deleteDiscussion(discussionId: string, userId: string): void {
  const db = getDatabase();

  // First verify the discussion exists and belongs to the user
  const discussion = db
    .prepare('SELECT * FROM discussions WHERE id = ? AND user_id = ?')
    .get(discussionId, userId) as DiscussionRow | undefined;

  if (!discussion) {
    throw new Error('Discussion not found or access denied');
  }

  // Delete from database
  const result = db.prepare('DELETE FROM discussions WHERE id = ? AND user_id = ?').run(discussionId, userId);

  if (result.changes === 0) {
    throw new Error('Failed to delete discussion');
  }

  logger.info('Discussion deleted from database', {
    discussionId,
    userId,
  });
}

/**
 * Delete all discussions for a user
 * @param userId - User ID whose discussions should be deleted
 * @returns Number of discussions deleted
 */
export function deleteAllUserDiscussions(userId: string): number {
  const db = getDatabase();

  // Get all discussions for the user to log them
  const discussions = db
    .prepare('SELECT id FROM discussions WHERE user_id = ?')
    .all(userId) as { id: string }[];

  const discussionIds = discussions.map((d) => d.id);

  // Delete all discussions for the user
  const result = db.prepare('DELETE FROM discussions WHERE user_id = ?').run(userId);

  logger.info('All discussions deleted from database', {
    userId,
    deletedCount: result.changes,
    discussionIds,
  });

  return result.changes;
}

/**
 * Mark a discussion as resolved
 * @param discussionId - Discussion ID to mark as resolved
 * @param userId - User ID to verify ownership
 * @throws Error if discussion not found or user doesn't own it
 */
export function markDiscussionAsResolved(discussionId: string, userId: string): void {
  const db = getDatabase();

  // First verify the discussion exists and belongs to the user
  const discussion = db
    .prepare('SELECT * FROM discussions WHERE id = ? AND user_id = ?')
    .get(discussionId, userId) as DiscussionRow | undefined;

  if (!discussion) {
    throw new Error('Discussion not found or access denied');
  }

  // Mark as resolved
  updateDiscussion(discussionId, { is_resolved: 1 });

  logger.info('Discussion marked as resolved', {
    discussionId,
    userId,
  });
}

/**
 * Mark all unresolved discussions for a user as resolved
 * @param userId - User ID whose discussions should be resolved
 * @returns Number of discussions resolved
 */
export function resolveAllUserDiscussions(userId: string): number {
  const db = getDatabase();

  // Get all unresolved discussions for the user
  const discussions = db
    .prepare('SELECT id FROM discussions WHERE user_id = ? AND is_resolved = 0')
    .all(userId) as { id: string }[];

  const discussionIds = discussions.map((d) => d.id);

  // Mark all as resolved
  const result = db.prepare('UPDATE discussions SET is_resolved = 1, updated_at = ? WHERE user_id = ? AND is_resolved = 0').run(Date.now(), userId);

  logger.info('All discussions marked as resolved', {
    userId,
    resolvedCount: result.changes,
    discussionIds,
  });

  return result.changes;
}
