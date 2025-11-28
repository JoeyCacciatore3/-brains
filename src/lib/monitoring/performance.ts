/**
 * Performance Monitoring
 * Tracks performance metrics and detects slow operations
 */

import { logger } from '@/lib/logger';
import { recordTiming, recordMetric } from './metrics';

const PERFORMANCE_TRACK_ENABLED = process.env.PERFORMANCE_TRACK_ENABLED !== 'false';
const PERFORMANCE_SLOW_THRESHOLD_MS = parseInt(
  process.env.PERFORMANCE_SLOW_THRESHOLD_MS || '5000',
  10
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface PerformanceContext {
  operation: string;
  startTime: number;
  metadata?: Record<string, unknown>;
}

/**
 * Track performance of an async operation
 */
export async function trackPerformance<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  if (!PERFORMANCE_TRACK_ENABLED) {
    return fn();
  }

  const startTime = Date.now();

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    recordTiming(`performance:${operation}`, duration);
    recordMetric(`performance:${operation}:count`, 1);

    // Log slow operations
    if (duration > PERFORMANCE_SLOW_THRESHOLD_MS) {
      logger.warn('Slow operation detected', {
        operation,
        duration,
        threshold: PERFORMANCE_SLOW_THRESHOLD_MS,
        ...metadata,
      });
      recordMetric(`performance:${operation}:slow`, 1);
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    recordTiming(`performance:${operation}:error`, duration);
    recordMetric(`performance:${operation}:errors`, 1);

    logger.error('Performance tracking error', {
      operation,
      duration,
      error: error instanceof Error ? error.message : String(error),
      ...metadata,
    });

    throw error;
  }
}

/**
 * Track performance of a synchronous operation
 */
export function trackPerformanceSync<T>(
  operation: string,
  fn: () => T,
  metadata?: Record<string, unknown>
): T {
  if (!PERFORMANCE_TRACK_ENABLED) {
    return fn();
  }

  const startTime = Date.now();

  try {
    const result = fn();
    const duration = Date.now() - startTime;

    recordTiming(`performance:${operation}`, duration);
    recordMetric(`performance:${operation}:count`, 1);

    // Log slow operations
    if (duration > PERFORMANCE_SLOW_THRESHOLD_MS) {
      logger.warn('Slow operation detected', {
        operation,
        duration,
        threshold: PERFORMANCE_SLOW_THRESHOLD_MS,
        ...metadata,
      });
      recordMetric(`performance:${operation}:slow`, 1);
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    recordTiming(`performance:${operation}:error`, duration);
    recordMetric(`performance:${operation}:errors`, 1);

    logger.error('Performance tracking error', {
      operation,
      duration,
      error: error instanceof Error ? error.message : String(error),
      ...metadata,
    });

    throw error;
  }
}

/**
 * Create a performance tracker
 */
export function createPerformanceTracker(operation: string, metadata?: Record<string, unknown>) {
  const startTime = Date.now();

  return {
    end: (success: boolean = true) => {
      const duration = Date.now() - startTime;
      recordTiming(`performance:${operation}`, duration);
      recordMetric(`performance:${operation}:count`, 1);

      if (duration > PERFORMANCE_SLOW_THRESHOLD_MS) {
        logger.warn('Slow operation detected', {
          operation,
          duration,
          threshold: PERFORMANCE_SLOW_THRESHOLD_MS,
          success,
          ...metadata,
        });
        recordMetric(`performance:${operation}:slow`, 1);
      }

      return duration;
    },
  };
}
