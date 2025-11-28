/**
 * Memory Management and Monitoring
 * Monitors memory usage and triggers cleanup when thresholds are exceeded
 */

import { logger } from './logger';
import { clearPromptCache } from './cache/prompt-cache';
import { clearResponseCache } from './cache/response-cache';

const WARNING_THRESHOLD = 0.8; // 80% heap usage
const CRITICAL_THRESHOLD = 0.9; // 90% heap usage

let monitoringInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Get current memory usage statistics
 */
function getMemoryStats() {
  const usage = process.memoryUsage();
  const heapPercent = usage.heapUsed / usage.heapTotal;

  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    heapPercent,
    heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024),
    heapPercentRounded: Math.round(heapPercent * 100),
    externalMB: Math.round(usage.external / 1024 / 1024),
    rssMB: Math.round(usage.rss / 1024 / 1024),
  };
}

/**
 * Clear all caches to free memory
 */
function clearAllCaches(): void {
  try {
    clearPromptCache();
    clearResponseCache();
    logger.info('All caches cleared due to memory pressure');
  } catch (error) {
    logger.error('Failed to clear caches', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Check memory usage and log warnings/errors
 * Triggers garbage collection if available and usage is critical
 */
function checkMemoryUsage(): void {
  try {
    const stats = getMemoryStats();

    // Log memory usage (info level for normal operation)
    if (stats.heapPercent >= CRITICAL_THRESHOLD) {
      logger.error('Memory usage critically high', {
        heapUsedMB: stats.heapUsedMB,
        heapTotalMB: stats.heapTotalMB,
        heapPercent: stats.heapPercentRounded,
        externalMB: stats.externalMB,
        rssMB: stats.rssMB,
        threshold: 'critical',
      });

      // Clear caches first to free memory
      clearAllCaches();

      // Trigger garbage collection if available
      if (global.gc && typeof global.gc === 'function') {
        try {
          global.gc();
          logger.info('Garbage collection triggered due to critical memory usage');

          // Check memory again after GC
          const afterGC = getMemoryStats();
          logger.info('Memory usage after GC', {
            heapUsedMB: afterGC.heapUsedMB,
            heapTotalMB: afterGC.heapTotalMB,
            heapPercent: afterGC.heapPercentRounded,
          });
        } catch (gcError) {
          logger.error('Failed to trigger garbage collection', {
            error: gcError instanceof Error ? gcError.message : String(gcError),
          });
        }
      } else {
        logger.warn('Garbage collection not available. Run Node.js with --expose-gc flag to enable manual GC.');
      }
    } else if (stats.heapPercent >= WARNING_THRESHOLD) {
      // At warning threshold, clear caches but don't trigger GC yet
      clearAllCaches();

      logger.warn('Memory usage high', {
        heapUsedMB: stats.heapUsedMB,
        heapTotalMB: stats.heapTotalMB,
        heapPercent: stats.heapPercentRounded,
        externalMB: stats.externalMB,
        rssMB: stats.rssMB,
        threshold: 'warning',
      });
    } else {
      // Log at debug level for normal operation
      logger.debug('Memory usage normal', {
        heapUsedMB: stats.heapUsedMB,
        heapTotalMB: stats.heapTotalMB,
        heapPercent: stats.heapPercentRounded,
      });
    }
  } catch (error) {
    logger.error('Error checking memory usage', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Setup periodic memory monitoring
 * Checks memory usage every 60 seconds
 *
 * @param intervalMs - Interval in milliseconds (default: 60000 = 60 seconds)
 */
export function setupMemoryMonitoring(intervalMs: number = 60000): void {
  // Only run in Node.js environment (not in tests unless explicitly enabled)
  if (typeof process === 'undefined' || typeof setInterval === 'undefined') {
    return;
  }

  // Stop existing monitoring if any
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  // Initial memory check
  checkMemoryUsage();

  // Set up periodic monitoring
  monitoringInterval = setInterval(() => {
    checkMemoryUsage();
  }, intervalMs);

  logger.info('Memory monitoring started', {
    intervalMs,
    warningThreshold: `${(WARNING_THRESHOLD * 100).toFixed(0)}%`,
    criticalThreshold: `${(CRITICAL_THRESHOLD * 100).toFixed(0)}%`,
  });
}

/**
 * Stop memory monitoring
 */
export function stopMemoryMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    logger.info('Memory monitoring stopped');
  }
}

/**
 * Get current memory statistics
 * Useful for health checks and monitoring endpoints
 */
export function getMemoryStatistics() {
  return getMemoryStats();
}
