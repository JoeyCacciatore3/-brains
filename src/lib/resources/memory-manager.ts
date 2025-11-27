/**
 * Memory Management
 * Monitors memory usage and performs cleanup
 */

import { logger } from '@/lib/logger';
import os from 'os';

const MEMORY_MONITORING_ENABLED = process.env.MEMORY_MONITORING_ENABLED !== 'false';
const MEMORY_CLEANUP_INTERVAL_MS = parseInt(process.env.MEMORY_CLEANUP_INTERVAL_MS || '300000', 10);
const MEMORY_PRESSURE_THRESHOLD = parseFloat(process.env.MEMORY_PRESSURE_THRESHOLD || '0.8');

/**
 * Get current memory usage
 */
export function getMemoryUsage(): {
  total: number;
  free: number;
  used: number;
  usage: number; // 0-1
} {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const usage = used / total;

  return {
    total,
    free,
    used,
    usage,
  };
}

/**
 * Check if memory pressure is high
 */
export function isMemoryPressureHigh(): boolean {
  if (!MEMORY_MONITORING_ENABLED) {
    return false;
  }

  const memory = getMemoryUsage();
  return memory.usage > MEMORY_PRESSURE_THRESHOLD;
}

/**
 * Perform memory cleanup
 */
export function performMemoryCleanup(): {
  cleaned: boolean;
  reason?: string;
} {
  if (!MEMORY_MONITORING_ENABLED) {
    return { cleaned: false };
  }

  const memory = getMemoryUsage();
  if (memory.usage <= MEMORY_PRESSURE_THRESHOLD) {
    return { cleaned: false };
  }

  // Trigger garbage collection if available
  if (global.gc) {
    global.gc();
    logger.info('Memory cleanup: Garbage collection triggered', {
      memoryUsage: memory.usage,
    });
    return { cleaned: true, reason: 'garbage-collection' };
  }

  // Log memory pressure
  logger.warn('Memory pressure detected', {
    usage: memory.usage,
    used: memory.used,
    total: memory.total,
  });

  return { cleaned: false, reason: 'no-gc-available' };
}

/**
 * Periodic memory cleanup
 */
function periodicCleanup(): void {
  if (!MEMORY_MONITORING_ENABLED) {
    return;
  }

  const memory = getMemoryUsage();
  if (memory.usage > MEMORY_PRESSURE_THRESHOLD) {
    performMemoryCleanup();
  }
}

// Start periodic cleanup
if (typeof setInterval !== 'undefined' && MEMORY_MONITORING_ENABLED) {
  setInterval(periodicCleanup, MEMORY_CLEANUP_INTERVAL_MS);
}
