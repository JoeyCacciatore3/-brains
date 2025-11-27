/**
 * Graceful Degradation
 * Implements strategies to maintain service under load
 */

import { logger } from '@/lib/logger';
import os from 'os';

const DEGRADATION_ENABLED = process.env.DEGRADATION_ENABLED !== 'false';
const DEGRADATION_CPU_THRESHOLD = parseFloat(process.env.DEGRADATION_CPU_THRESHOLD || '0.8');
const DEGRADATION_MEMORY_THRESHOLD = parseFloat(process.env.DEGRADATION_MEMORY_THRESHOLD || '0.8');
const DEGRADATION_ACTIVE_REQUESTS_THRESHOLD = parseInt(
  process.env.DEGRADATION_ACTIVE_REQUESTS_THRESHOLD || '100',
  10
);

let activeRequests = 0;

/**
 * Get current system load
 */
export function getSystemLoad(): {
  cpuUsage: number;
  memoryUsage: number;
  activeRequests: number;
} {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = usedMemory / totalMemory;

  // Simplified CPU usage (would need more sophisticated monitoring for accurate CPU)
  // For now, use memory as proxy
  const cpuUsage = memoryUsage; // Simplified

  return {
    cpuUsage,
    memoryUsage,
    activeRequests,
  };
}

/**
 * Check if system should degrade
 */
export function shouldDegrade(): {
  degrade: boolean;
  reason?: string;
  load: ReturnType<typeof getSystemLoad>;
} {
  if (!DEGRADATION_ENABLED) {
    return { degrade: false, load: getSystemLoad() };
  }

  const load = getSystemLoad();

  if (load.cpuUsage > DEGRADATION_CPU_THRESHOLD) {
    return {
      degrade: true,
      reason: `CPU usage high: ${(load.cpuUsage * 100).toFixed(1)}%`,
      load,
    };
  }

  if (load.memoryUsage > DEGRADATION_MEMORY_THRESHOLD) {
    return {
      degrade: true,
      reason: `Memory usage high: ${(load.memoryUsage * 100).toFixed(1)}%`,
      load,
    };
  }

  if (load.activeRequests > DEGRADATION_ACTIVE_REQUESTS_THRESHOLD) {
    return {
      degrade: true,
      reason: `Active requests high: ${load.activeRequests}`,
      load,
    };
  }

  return { degrade: false, load };
}

/**
 * Get degradation strategy
 */
export function getDegradationStrategy(): {
  reduceMaxTokens: boolean;
  skipNonCriticalOps: boolean;
  enableQueue: boolean;
  useCache: boolean;
} {
  const degradation = shouldDegrade();

  if (!degradation.degrade) {
    return {
      reduceMaxTokens: false,
      skipNonCriticalOps: false,
      enableQueue: false,
      useCache: true,
    };
  }

  // Aggressive degradation if load is very high
  const isHighLoad =
    degradation.load.cpuUsage > 0.9 ||
    degradation.load.memoryUsage > 0.9 ||
    degradation.load.activeRequests > DEGRADATION_ACTIVE_REQUESTS_THRESHOLD * 1.5;

  return {
    reduceMaxTokens: true,
    skipNonCriticalOps: isHighLoad,
    enableQueue: isHighLoad,
    useCache: true,
  };
}

/**
 * Increment active request count
 */
export function incrementActiveRequests(): void {
  activeRequests += 1;
}

/**
 * Decrement active request count
 */
export function decrementActiveRequests(): void {
  activeRequests = Math.max(0, activeRequests - 1);
}

/**
 * Get reduced max tokens based on degradation
 */
export function getReducedMaxTokens(defaultMaxTokens: number): number {
  const strategy = getDegradationStrategy();
  if (!strategy.reduceMaxTokens) {
    return defaultMaxTokens;
  }

  // Reduce by 25% under degradation
  return Math.floor(defaultMaxTokens * 0.75);
}

/**
 * Check if non-critical operation should be skipped
 */
export function shouldSkipNonCriticalOperation(operation: string): boolean {
  const strategy = getDegradationStrategy();
  if (!strategy.skipNonCriticalOps) {
    return false;
  }

  // List of non-critical operations
  const nonCriticalOps = [
    'generate-questions',
    'generate-summary',
    'background-cleanup',
  ];

  return nonCriticalOps.includes(operation);
}
