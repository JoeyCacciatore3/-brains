/**
 * Database Monitoring
 * Tracks database performance and health
 */

import { logger } from '@/lib/logger';
import { getDatabase } from './index';
import { recordTiming, recordMetric } from '@/lib/monitoring/metrics';

/**
 * Track database query performance
 */
export function trackQuery<T>(
  operation: string,
  query: () => T
): T {
  const startTime = Date.now();
  try {
    const result = query();
    const duration = Date.now() - startTime;
    recordTiming(`database:${operation}`, duration);
    recordMetric(`database:${operation}:count`, 1);

    // Log slow queries
    if (duration > 1000) {
      logger.warn('Slow database query', {
        operation,
        duration,
      });
      recordMetric(`database:${operation}:slow`, 1);
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    recordTiming(`database:${operation}:error`, duration);
    recordMetric(`database:${operation}:errors`, 1);
    throw error;
  }
}

/**
 * Get database size
 */
export function getDatabaseSize(): {
  size: number;
  sizeMB: number;
} {
  try {
    const db = getDatabase();
    const result = db
      .prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()")
      .get() as { size: number };

    return {
      size: result.size || 0,
      sizeMB: (result.size || 0) / (1024 * 1024),
    };
  } catch (error) {
    logger.error('Failed to get database size', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { size: 0, sizeMB: 0 };
  }
}

/**
 * Get database statistics
 */
export function getDatabaseStats(): {
  discussions: number;
  messages: number;
  users: number;
  costRecords: number;
  sizeMB: number;
} {
  try {
    const db = getDatabase();
    const discussions = (db.prepare('SELECT COUNT(*) as count FROM discussions').get() as { count: number }).count;
    const messages = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }).count;
    const users = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
    const costRecords = (db.prepare('SELECT COUNT(*) as count FROM cost_tracking').get() as { count: number }).count;
    const { sizeMB } = getDatabaseSize();

    return {
      discussions,
      messages,
      users,
      costRecords,
      sizeMB,
    };
  } catch (error) {
    logger.error('Failed to get database stats', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      discussions: 0,
      messages: 0,
      users: 0,
      costRecords: 0,
      sizeMB: 0,
    };
  }
}
