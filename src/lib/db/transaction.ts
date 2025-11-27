/**
 * Database Transaction Wrapper
 * Provides a consistent interface for database transactions
 */

import { getDatabase } from './index';
import type Database from 'better-sqlite3';

/**
 * Execute a function within a database transaction
 * Automatically handles commit on success and rollback on error
 *
 * @param fn - Function that receives database instance and returns a value
 * @returns The return value of the function
 * @throws Error if transaction fails
 *
 * @example
 * ```typescript
 * const result = withTransaction((db) => {
 *   const discussion = createDiscussion(db, userId, topic);
 *   const message = addMessage(db, discussionId, content);
 *   return { discussion, message };
 * });
 * ```
 */
export function withTransaction<T>(fn: (db: Database.Database) => T): T {
  const db = getDatabase();

  // better-sqlite3 transactions are automatically atomic
  // The transaction() method automatically passes the database instance
  // Create a transaction wrapper that calls fn with db
  const transaction = db.transaction(() => {
    return fn(db);
  });

  // Execute the transaction (no arguments needed - better-sqlite3 handles it)
  // On success: commits automatically
  // On error: rolls back automatically
  // Use type assertion to match existing code patterns in the codebase
  return transaction() as T;
}
