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
  // Get current database token count for validation
  const currentDiscussion = getDiscussion(discussionId);
  const dbTokenCount = currentDiscussion?.token_count || 0;

  // Log mismatch for monitoring (but still sync - file is source of truth)
  if (Math.abs(dbTokenCount - tokenCount) > 10) {
    logger.warn('Token count mismatch detected during sync', {
      discussionId,
      dbTokenCount,
      fileTokenCount: tokenCount,
      difference: Math.abs(dbTokenCount - tokenCount),
    });
  }

  updateDiscussion(discussionId, {
    token_count: tokenCount,
  });
}

/**
 * Get discussion by ID
 */
export function getDiscussion(id: string): Discussion | null {
  const row = getDatabase().prepare('SELECT * FROM discussions WHERE id = ?').get(id) as
    | DiscussionRow
    | undefined;

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
 * Atomically check for active discussion
 * Uses transaction with BEGIN IMMEDIATE to prevent race conditions
 * @returns Active discussion if exists, null otherwise
 */
export function checkActiveDiscussionAtomically(userId: string): Discussion | null {
  const db = getDatabase();

  // Use BEGIN IMMEDIATE to get exclusive lock immediately
  const transaction = db.transaction(() => {
    // Check for active discussion with exclusive lock
    const activeRow = db
      .prepare(
        `SELECT * FROM discussions
         WHERE user_id = ? AND is_resolved = 0
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(userId) as DiscussionRow | undefined;

    if (!activeRow) {
      return null;
    }

    return {
      id: activeRow.id,
      user_id: activeRow.user_id,
      topic: activeRow.topic,
      file_path_json: activeRow.file_path_json,
      file_path_md: activeRow.file_path_md,
      token_count: activeRow.token_count,
      token_limit: activeRow.token_limit,
      summary: activeRow.summary,
      summary_created_at: activeRow.summary_created_at,
      created_at: activeRow.created_at,
      updated_at: activeRow.updated_at,
      is_resolved: activeRow.is_resolved,
      needs_user_input: activeRow.needs_user_input,
      user_input_pending: activeRow.user_input_pending,
      current_turn: activeRow.current_turn,
    };
  });

  try {
    return transaction();
  } catch (error) {
    // Transaction automatically rolls back on error
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
    >
  >
): void {
  const db = getDatabase();
  const now = Date.now();

  const fields: string[] = ['updated_at = ?'];
  const values: Array<string | number | null> = [now];

  if (updates.token_count !== undefined) {
    fields.push('token_count = ?');
    values.push(updates.token_count);
  }

  if (updates.summary !== undefined) {
    fields.push('summary = ?');
    values.push(updates.summary);
  }

  if (updates.summary_created_at !== undefined) {
    fields.push('summary_created_at = ?');
    values.push(updates.summary_created_at);
  }

  if (updates.is_resolved !== undefined) {
    fields.push('is_resolved = ?');
    values.push(updates.is_resolved);
  }

  if (updates.needs_user_input !== undefined) {
    fields.push('needs_user_input = ?');
    values.push(updates.needs_user_input);
  }

  if (updates.user_input_pending !== undefined) {
    fields.push('user_input_pending = ?');
    values.push(updates.user_input_pending);
  }

  if (updates.current_turn !== undefined) {
    fields.push('current_turn = ?');
    values.push(updates.current_turn);
  }

  values.push(id);

  // Wrap update in transaction to ensure atomicity
  const transaction = db.transaction(() => {
    db.prepare(`UPDATE discussions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  });

  try {
    transaction();
  } catch (error) {
    // Transaction automatically rolls back on error
    throw error;
  }
}

/**
 * Resolve a discussion (mark as resolved)
 */
export function resolveDiscussion(id: string): void {
  updateDiscussion(id, {
    is_resolved: 1,
  });
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
