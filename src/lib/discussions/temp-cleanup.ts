/**
 * Periodic cleanup job for orphaned temp files
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';

const DISCUSSIONS_DIR =
  process.env.DISCUSSIONS_DIR || path.join(process.cwd(), 'data', 'discussions');
const TEMP_FILE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // Run every 10 minutes

/**
 * Clean up orphaned temp files
 */
export async function cleanupTempFiles(): Promise<{
  cleaned: number;
  errors: number;
  totalSize: number;
}> {
  let cleaned = 0;
  let errors = 0;
  let totalSize = 0;

  try {
    // Get all discussion directories
    const userDirs = await fs.readdir(DISCUSSIONS_DIR, { withFileTypes: true });

    for (const userDir of userDirs) {
      if (!userDir.isDirectory()) continue;

      const userPath = path.join(DISCUSSIONS_DIR, userDir.name);

      try {
        // Get all files in user directory
        const files = await fs.readdir(userPath, { withFileTypes: true });

        for (const file of files) {
          if (!file.isFile()) continue;

          // Check if file is a temp file (contains .tmp.)
          if (file.name.includes('.tmp.')) {
            const filePath = path.join(userPath, file.name);

            try {
              // Get file stats
              const stats = await fs.stat(filePath);
              const age = Date.now() - stats.mtimeMs;

              // Delete if older than max age
              if (age > TEMP_FILE_MAX_AGE_MS) {
                await fs.unlink(filePath);
                cleaned++;
                totalSize += stats.size;
                logger.debug('Cleaned up orphaned temp file', {
                  file: filePath,
                  age: age,
                  size: stats.size,
                });
              }
            } catch (error) {
              errors++;
              logger.warn('Failed to cleanup temp file', {
                file: filePath,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      } catch (error) {
        logger.warn('Failed to read user directory for temp cleanup', {
          userDir: userDir.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (cleaned > 0) {
      logger.info('Temp file cleanup completed', {
        cleaned,
        errors,
        totalSize,
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      });
    }

    return { cleaned, errors, totalSize };
  } catch (error) {
    logger.error('Temp file cleanup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Start periodic temp file cleanup
 */
export function startTempFileCleanup(): void {
  // Run immediately
  cleanupTempFiles().catch((error) => {
    logger.error('Initial temp file cleanup failed', { error });
  });

  // Then run periodically
  if (typeof setInterval !== 'undefined') {
    setInterval(() => {
      cleanupTempFiles().catch((error) => {
        logger.error('Periodic temp file cleanup failed', { error });
      });
    }, CLEANUP_INTERVAL_MS);

    logger.info('Temp file cleanup job started', {
      interval: CLEANUP_INTERVAL_MS,
      maxAge: TEMP_FILE_MAX_AGE_MS,
    });
  }
}
