import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '@/lib/logger';

// Make database path configurable via environment variable
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'conversations.db');
const dbDir = path.dirname(dbPath);

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export function createDatabase(): Database.Database {
  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');

  // Create users table for OAuth authentication
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      image TEXT,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(provider, provider_id)
    )
  `);

  // DEPRECATED: conversations table removed
  // Legacy conversations table kept commented for migration reference only.
  // All new code must use the discussions table.
  // If you need to migrate legacy data, uncomment and use temporarily:
  /*
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_resolved INTEGER NOT NULL DEFAULT 0,
      needs_user_input INTEGER NOT NULL DEFAULT 0,
      user_input_pending TEXT,
      current_turn INTEGER NOT NULL DEFAULT 0
    )
  `);
  */

  // Create discussions table (PRIMARY - use this for all new discussions)
  // This is the main table for the round-based discussion system.
  // It stores metadata only - full discussion data is stored in file system (JSON + Markdown).
  // Note: Foreign key constraint removed to support anonymous users (user_id may not exist in users table)
  // For authenticated users, user_id will reference users(id), but anonymous users use temporary IDs
  db.exec(`
    CREATE TABLE IF NOT EXISTS discussions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      file_path_json TEXT NOT NULL,
      file_path_md TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      token_limit INTEGER NOT NULL DEFAULT 4000,
      summary TEXT,
      summary_created_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_resolved INTEGER NOT NULL DEFAULT 0,
      needs_user_input INTEGER NOT NULL DEFAULT 0,
      user_input_pending TEXT,
      current_turn INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Create messages table
  // Note: For discussion system, messages are stored in file system, not database.
  // Database messages table is kept for backward compatibility with legacy conversations only.
  // For new discussions, use rounds stored in file system (JSON + Markdown files).
  // DEPRECATED: conversation_id field removed - use discussion_id only
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discussion_id TEXT NOT NULL, -- PRIMARY: Use this for all discussions
      persona TEXT NOT NULL,
      content TEXT NOT NULL,
      turn INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (discussion_id) REFERENCES discussions(id) ON DELETE CASCADE
    )
  `);

  // Migration: Remove conversation_id column if it exists (for existing databases)
  // This migration handles the transition from deprecated conversation_id to discussion_id only
  try {
    const tableInfo = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    const hasConversationId = tableInfo.some((col) => col.name === 'conversation_id');
    const hasDiscussionId = tableInfo.some((col) => col.name === 'discussion_id');

    // Ensure discussion_id exists
    if (!hasDiscussionId) {
      db.exec(`
        ALTER TABLE messages ADD COLUMN discussion_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_messages_discussion_id ON messages(discussion_id);
      `);
      logger.info('Migration: Added discussion_id column to messages table');
    }

    // Note: SQLite doesn't support DROP COLUMN directly, so conversation_id will remain
    // in existing databases but should not be used. New databases won't have it.
    if (hasConversationId) {
      logger.info('Migration: conversation_id column exists in messages table (deprecated, not used)');
    }
  } catch (error) {
    // Migration might have already run, ignore error
    logger.debug('Migration check for messages table columns', { error });
  }

  // Migration: Update token_limit default for existing discussions
  try {
    const discussionsWithOldLimit = db
      .prepare('SELECT COUNT(*) as count FROM discussions WHERE token_limit = 4800')
      .get() as { count: number };

    if (discussionsWithOldLimit.count > 0) {
      db.exec(`
        UPDATE discussions
        SET token_limit = 4000
        WHERE token_limit = 4800
      `);
      logger.info('Migration: Updated token_limit from 4800 to 4000', {
        updatedCount: discussionsWithOldLimit.count,
      });
    }
  } catch (error) {
    logger.debug('Migration check for token_limit', { error });
  }

  // Create indexes
  // Note: conversation_id index removed - use discussion_id only
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_discussion_id
    ON messages(discussion_id);

    CREATE INDEX IF NOT EXISTS idx_messages_created_at
    ON messages(created_at);

    CREATE INDEX IF NOT EXISTS idx_discussions_user_id
    ON discussions(user_id);

    CREATE INDEX IF NOT EXISTS idx_discussions_is_resolved
    ON discussions(is_resolved);

    CREATE INDEX IF NOT EXISTS idx_discussions_created_at
    ON discussions(created_at);

    CREATE INDEX IF NOT EXISTS idx_discussions_user_id_is_resolved
    ON discussions(user_id, is_resolved);

    CREATE INDEX IF NOT EXISTS idx_discussions_updated_at
    ON discussions(updated_at);

    CREATE INDEX IF NOT EXISTS idx_users_email
    ON users(email);

    CREATE INDEX IF NOT EXISTS idx_users_provider
    ON users(provider, provider_id);
  `);

  return db;
}
