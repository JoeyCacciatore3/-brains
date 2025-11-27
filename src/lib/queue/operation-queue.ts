/**
 * Operation Queue
 * Queues LLM operations for high load scenarios
 */

import { logger } from '@/lib/logger';
import { getRedisClient } from '@/lib/db/redis';

const QUEUE_ENABLED = process.env.QUEUE_ENABLED === 'true';
const QUEUE_MAX_SIZE = parseInt(process.env.QUEUE_MAX_SIZE || '1000', 10);
const QUEUE_WORKER_COUNT = parseInt(process.env.QUEUE_WORKER_COUNT || '3', 10);
const QUEUE_PROCESSING_INTERVAL_MS = parseInt(process.env.QUEUE_PROCESSING_INTERVAL_MS || '100', 10);

export interface QueuedOperation {
  id: string;
  operation: string;
  priority: number; // Higher = more priority
  data: unknown;
  timestamp: number;
  retries: number;
}

// In-memory queue
const operationQueue: QueuedOperation[] = [];
let processing = false;

/**
 * Enqueue an operation
 */
export function enqueueOperation(
  operation: string,
  data: unknown,
  priority: number = 0
): string | null {
  if (!QUEUE_ENABLED) {
    return null; // Queue disabled, return null to indicate immediate processing
  }

  if (operationQueue.length >= QUEUE_MAX_SIZE) {
    logger.warn('Operation queue full', {
      operation,
      queueSize: operationQueue.length,
    });
    return null;
  }

  const id = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const queued: QueuedOperation = {
    id,
    operation,
    priority,
    data,
    timestamp: Date.now(),
    retries: 0,
  };

  operationQueue.push(queued);
  operationQueue.sort((a, b) => b.priority - a.priority); // Sort by priority

  logger.debug('Operation enqueued', {
    id,
    operation,
    priority,
    queueSize: operationQueue.length,
  });

  return id;
}

/**
 * Process queue
 */
async function processQueue(): Promise<void> {
  if (!QUEUE_ENABLED || processing || operationQueue.length === 0) {
    return;
  }

  processing = true;

  try {
    // Process up to QUEUE_WORKER_COUNT operations
    const toProcess = operationQueue.splice(0, QUEUE_WORKER_COUNT);

    for (const item of toProcess) {
      try {
        // Operation processing would be handled by the caller
        logger.debug('Processing queued operation', {
          id: item.id,
          operation: item.operation,
        });
      } catch (error) {
        logger.error('Failed to process queued operation', {
          id: item.id,
          operation: item.operation,
          error: error instanceof Error ? error.message : String(error),
        });

        // Retry logic could be added here
        item.retries += 1;
        if (item.retries < 3) {
          operationQueue.push(item);
        }
      }
    }
  } finally {
    processing = false;
  }
}

/**
 * Get queue status
 */
export function getQueueStatus(): {
  size: number;
  maxSize: number;
  processing: boolean;
} {
  return {
    size: operationQueue.length,
    maxSize: QUEUE_MAX_SIZE,
    processing,
  };
}

// Start queue processing if enabled
if (typeof setInterval !== 'undefined' && QUEUE_ENABLED) {
  setInterval(processQueue, QUEUE_PROCESSING_INTERVAL_MS);
}
