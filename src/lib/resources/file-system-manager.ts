/**
 * File System Management
 * Monitors disk space and performs cleanup
 */

import { logger } from '@/lib/logger';
import fs from 'fs';
import path from 'path';

const FILE_CLEANUP_ENABLED = process.env.FILE_CLEANUP_ENABLED !== 'false';
const DISK_SPACE_MONITORING_ENABLED = process.env.DISK_SPACE_MONITORING_ENABLED !== 'false';
const FILE_CLEANUP_INTERVAL_HOURS = parseInt(process.env.FILE_CLEANUP_INTERVAL_HOURS || '24', 10);

/**
 * Get disk space information
 */
export function getDiskSpaceInfo(dir: string): {
  total: number;
  free: number;
  used: number;
  usage: number; // 0-1
} {
  try {
    const stats = fs.statfsSync(dir);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    const used = total - free;
    const usage = used / total;

    return {
      total,
      free,
      used,
      usage,
    };
  } catch (error) {
    logger.warn('Failed to get disk space info', {
      error: error instanceof Error ? error.message : String(error),
      dir,
    });
    return {
      total: 0,
      free: 0,
      used: 0,
      usage: 0,
    };
  }
}

/**
 * Check if disk space is low
 */
export function isDiskSpaceLow(dir: string, threshold: number = 0.1): boolean {
  if (!DISK_SPACE_MONITORING_ENABLED) {
    return false;
  }

  const diskInfo = getDiskSpaceInfo(dir);
  return diskInfo.usage > 1 - threshold;
}

/**
 * Cleanup old backup files
 */
export function cleanupOldBackups(backupsDir: string, retentionDays: number): {
  cleaned: number;
  freed: number;
} {
  if (!FILE_CLEANUP_ENABLED) {
    return { cleaned: 0, freed: 0 };
  }

  try {
    if (!fs.existsSync(backupsDir)) {
      return { cleaned: 0, freed: 0 };
    }

    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;
    let freed = 0;

    const entries = fs.readdirSync(backupsDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(backupsDir, entry.name);
      const stats = fs.statSync(fullPath);

      if (stats.mtimeMs < cutoffTime) {
        const size = stats.size;
        fs.unlinkSync(fullPath);
        cleaned += 1;
        freed += size;
      }
    }

    if (cleaned > 0) {
      logger.info('Cleaned up old backup files', {
        cleaned,
        freed,
        retentionDays,
      });
    }

    return { cleaned, freed };
  } catch (error) {
    logger.error('Failed to cleanup old backups', {
      error: error instanceof Error ? error.message : String(error),
      backupsDir,
    });
    return { cleaned: 0, freed: 0 };
  }
}

/**
 * Cleanup orphaned discussion files
 */
export function cleanupOrphanedFiles(
  discussionsDir: string,
  db: { prepare: (sql: string) => { all: () => Array<{ id: string }> } }
): {
  cleaned: number;
} {
  if (!FILE_CLEANUP_ENABLED) {
    return { cleaned: 0 };
  }

  try {
    if (!fs.existsSync(discussionsDir)) {
      return { cleaned: 0 };
    }

    // Get all discussion IDs from database
    const discussions = db.prepare('SELECT id FROM discussions').all() as Array<{ id: string }>;
    const validIds = new Set(discussions.map((d) => d.id));

    let cleaned = 0;

    // Check each user directory
    const userDirs = fs.readdirSync(discussionsDir, { withFileTypes: true });
    for (const userDir of userDirs) {
      if (!userDir.isDirectory()) {
        continue;
      }

      const userPath = path.join(discussionsDir, userDir.name);
      const files = fs.readdirSync(userPath);

      for (const file of files) {
        if (file.endsWith('.json') || file.endsWith('.md')) {
          const discussionId = file.replace(/\.(json|md)$/, '');
          if (!validIds.has(discussionId)) {
            const filePath = path.join(userPath, file);
            fs.unlinkSync(filePath);
            cleaned += 1;
          }
        }
      }
    }

    if (cleaned > 0) {
      logger.info('Cleaned up orphaned discussion files', {
        cleaned,
      });
    }

    return { cleaned };
  } catch (error) {
    logger.error('Failed to cleanup orphaned files', {
      error: error instanceof Error ? error.message : String(error),
      discussionsDir,
    });
    return { cleaned: 0 };
  }
}

/**
 * Periodic file system cleanup
 */
function periodicCleanup(): void {
  if (!FILE_CLEANUP_ENABLED) {
    return;
  }

  try {
    const backupsDir = process.env.BACKUPS_DIR || 'data/backups';
    const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
    cleanupOldBackups(backupsDir, retentionDays);
  } catch (error) {
    logger.error('Periodic file cleanup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Start periodic cleanup
if (typeof setInterval !== 'undefined' && FILE_CLEANUP_ENABLED) {
  const intervalMs = FILE_CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;
  setInterval(periodicCleanup, intervalMs);
}
