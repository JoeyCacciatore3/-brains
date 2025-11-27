/**
 * Database Migration System
 * Tracks schema versions and applies migrations
 */

import { logger } from '@/lib/logger';
import { getDatabase } from './index';

const DB_MIGRATIONS_ENABLED = process.env.DB_MIGRATIONS_ENABLED !== 'false';
const DB_MIGRATIONS_AUTO_RUN = process.env.DB_MIGRATIONS_AUTO_RUN === 'true';

export interface Migration {
  version: number;
  name: string;
  up: (db: ReturnType<typeof getDatabase>) => void;
  down?: (db: ReturnType<typeof getDatabase>) => void;
}

// Registered migrations
const migrations: Migration[] = [];

/**
 * Register a migration
 */
export function registerMigration(migration: Migration): void {
  migrations.push(migration);
  migrations.sort((a, b) => a.version - b.version);
}

/**
 * Get current schema version
 */
export function getCurrentVersion(db: ReturnType<typeof getDatabase>): number {
  try {
    const result = db
      .prepare('SELECT MAX(version) as version FROM schema_migrations')
      .get() as { version: number | null };

    return result.version || 0;
  } catch {
    return 0;
  }
}

/**
 * Apply migrations
 */
export function applyMigrations(): {
  applied: number;
  errors: string[];
} {
  if (!DB_MIGRATIONS_ENABLED) {
    return { applied: 0, errors: [] };
  }

  const db = getDatabase();
  const currentVersion = getCurrentVersion(db);
  const toApply = migrations.filter((m) => m.version > currentVersion);

  if (toApply.length === 0) {
    return { applied: 0, errors: [] };
  }

  const errors: string[] = [];
  let applied = 0;

  for (const migration of toApply) {
    try {
      logger.info('Applying migration', {
        version: migration.version,
        name: migration.name,
      });

      migration.up(db);

      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
      ).run(migration.version, migration.name, Date.now());

      applied += 1;
      logger.info('Migration applied successfully', {
        version: migration.version,
        name: migration.name,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Migration ${migration.version} (${migration.name}): ${errorMessage}`);
      logger.error('Migration failed', {
        version: migration.version,
        name: migration.name,
        error: errorMessage,
      });
    }
  }

  return { applied, errors };
}

/**
 * Rollback last migration
 */
export function rollbackLastMigration(): {
  rolledBack: boolean;
  error?: string;
} {
  if (!DB_MIGRATIONS_ENABLED) {
    return { rolledBack: false, error: 'Migrations disabled' };
  }

  const db = getDatabase();
  const currentVersion = getCurrentVersion(db);

  if (currentVersion === 0) {
    return { rolledBack: false, error: 'No migrations to rollback' };
  }

  const migration = migrations.find((m) => m.version === currentVersion);
  if (!migration || !migration.down) {
    return { rolledBack: false, error: 'Migration does not support rollback' };
  }

  try {
    migration.down(db);

    db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(currentVersion);

    logger.info('Migration rolled back', {
      version: currentVersion,
      name: migration.name,
    });

    return { rolledBack: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Rollback failed', {
      version: currentVersion,
      error: errorMessage,
    });
    return { rolledBack: false, error: errorMessage };
  }
}

// Auto-apply migrations on module load if enabled
if (DB_MIGRATIONS_ENABLED && DB_MIGRATIONS_AUTO_RUN) {
  try {
    const result = applyMigrations();
    if (result.applied > 0) {
      logger.info('Auto-applied migrations', { applied: result.applied });
    }
    if (result.errors.length > 0) {
      logger.error('Migration errors', { errors: result.errors });
    }
  } catch (error) {
    logger.error('Failed to auto-apply migrations', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
