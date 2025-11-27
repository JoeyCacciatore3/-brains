/**
 * File Backup Manager
 * Handles periodic backups of discussion files with retention policy
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';
import { readDiscussion } from './file-manager';
import { getDiscussion, getUserDiscussions } from '@/lib/db/discussions';
import { BACKUP_CONFIG } from '@/lib/config';

const BACKUPS_DIR =
  process.env.BACKUPS_DIR || path.join(process.cwd(), 'data', 'backups');

/**
 * Ensure backup directory exists
 */
async function ensureBackupDirectory(userId: string): Promise<string> {
  const userBackupDir = path.join(BACKUPS_DIR, userId);
  try {
    await fs.mkdir(userBackupDir, { recursive: true });
  } catch (error) {
    logger.error('Failed to create backup directory', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      path: userBackupDir,
    });
    throw error;
  }
  return userBackupDir;
}

/**
 * Create a backup of a discussion
 * @param userId - User ID
 * @param discussionId - Discussion ID
 * @returns Backup directory path
 */
export async function backupDiscussion(
  userId: string,
  discussionId: string
): Promise<string> {
  if (!BACKUP_CONFIG.ENABLED) {
    logger.debug('Backup disabled, skipping', { userId, discussionId });
    return '';
  }

  try {
    // Verify discussion exists
    const discussion = getDiscussion(discussionId, userId);
    if (!discussion) {
      logger.warn('Discussion not found for backup', { userId, discussionId });
      return '';
    }

    // Verify ownership
    if (discussion.user_id !== userId) {
      logger.warn('User does not own discussion for backup', {
        userId,
        discussionId,
        ownerId: discussion.user_id,
      });
      return '';
    }

    // Read discussion data
    const discussionData = await readDiscussion(discussionId, userId);

    // Create backup directory with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(
      await ensureBackupDirectory(userId),
      `${discussionId}-${timestamp}`
    );
    await fs.mkdir(backupDir, { recursive: true });

    // Copy JSON file
    const jsonSource = path.join(
      process.cwd(),
      discussion.file_path_json.replace(/^data\//, 'data/')
    );
    const jsonDest = path.join(backupDir, `${discussionId}.json`);
    await fs.copyFile(jsonSource, jsonDest);

    // Copy Markdown file
    const mdSource = path.join(
      process.cwd(),
      discussion.file_path_md.replace(/^data\//, 'data/')
    );
    const mdDest = path.join(backupDir, `${discussionId}.md`);
    await fs.copyFile(mdSource, mdDest);

    // Create backup metadata file
    const metadata = {
      discussionId,
      userId,
      timestamp: new Date().toISOString(),
      roundCount: discussionData.rounds?.length || 0,
      tokenCount: discussion.token_count || 0,
    };
    await fs.writeFile(
      path.join(backupDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    logger.info('Discussion backed up successfully', {
      userId,
      discussionId,
      backupDir,
    });

    return backupDir;
  } catch (error) {
    logger.error('Failed to backup discussion', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      discussionId,
    });
    throw error;
  }
}

/**
 * Clean up old backups based on retention policy
 */
export async function cleanupOldBackups(): Promise<void> {
  if (!BACKUP_CONFIG.ENABLED) {
    return;
  }

  try {
    const retentionDays = BACKUP_CONFIG.RETENTION_DAYS;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // Get all user directories
    const users = await fs.readdir(BACKUPS_DIR).catch(() => []);
    let totalDeleted = 0;

    for (const userId of users) {
      const userBackupDir = path.join(BACKUPS_DIR, userId);
      try {
        const backups = await fs.readdir(userBackupDir);
        for (const backup of backups) {
          const backupPath = path.join(userBackupDir, backup);
          const stats = await fs.stat(backupPath);
          if (stats.isDirectory() && stats.mtime < cutoffDate) {
            await fs.rm(backupPath, { recursive: true, force: true });
            totalDeleted++;
            logger.debug('Deleted old backup', { userId, backup });
          }
        }
      } catch (error) {
        logger.warn('Error cleaning up backups for user', {
          error: error instanceof Error ? error.message : String(error),
          userId,
        });
      }
    }

    if (totalDeleted > 0) {
      logger.info('Backup cleanup completed', { totalDeleted });
    }
  } catch (error) {
    logger.error('Failed to cleanup old backups', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Schedule periodic backups for active discussions
 */
export async function schedulePeriodicBackups(): Promise<void> {
  if (!BACKUP_CONFIG.ENABLED) {
    logger.info('Backup system disabled, not scheduling periodic backups');
    return;
  }

  const intervalHours = BACKUP_CONFIG.INTERVAL_HOURS;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  logger.info('Starting periodic backup scheduler', {
    intervalHours,
    intervalMs,
  });

  // Run initial cleanup
  await cleanupOldBackups();

  // Schedule periodic backups
  setInterval(async () => {
    try {
      logger.debug('Running periodic backup cycle');

      // Get all users with discussions (this is a simplified approach)
      // In production, you might want to track active discussions more efficiently
      const allUsers = await fs.readdir(BACKUPS_DIR).catch(() => []);

      // For each user, get their active discussions and backup them
      // Note: This is a simplified implementation. In production, you'd want
      // to query the database for active discussions more efficiently
      let backedUp = 0;
      for (const userId of allUsers) {
        try {
          const discussions = getUserDiscussions(userId);
          const activeDiscussions = discussions.filter((d) => !d.is_resolved);

          for (const discussion of activeDiscussions) {
            try {
              await backupDiscussion(userId, discussion.id);
              backedUp++;
            } catch (error) {
              logger.warn('Failed to backup discussion in periodic cycle', {
                error: error instanceof Error ? error.message : String(error),
                userId,
                discussionId: discussion.id,
              });
            }
          }
        } catch (error) {
          logger.warn('Error processing user for periodic backup', {
            error: error instanceof Error ? error.message : String(error),
            userId,
          });
        }
      }

      if (backedUp > 0) {
        logger.info('Periodic backup cycle completed', { backedUp });
      }

      // Cleanup old backups
      await cleanupOldBackups();
    } catch (error) {
      logger.error('Error in periodic backup cycle', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, intervalMs);
}
