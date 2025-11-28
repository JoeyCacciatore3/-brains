/**
 * Error Deduplication System
 * Prevents duplicate error emissions and reduces log noise
 */

import { Server } from 'socket.io';
import { logger } from '@/lib/logger';
import { ErrorCode } from '@/lib/errors';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ErrorFingerprint {
  code: ErrorCode | string;
  discussionId?: string;
  operation: string;
  timestamp: number;
}

interface ErrorEntry {
  fingerprint: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

const ERROR_DEDUPLICATION_WINDOW_MS = parseInt(
  process.env.ERROR_DEDUPLICATION_WINDOW_MS || '5000',
  10
);
const ERROR_THROTTLE_WINDOW_MS = parseInt(
  process.env.ERROR_THROTTLE_WINDOW_MS || '5000',
  10
);

// In-memory store for error tracking
const errorStore = new Map<string, ErrorEntry>();

/**
 * Generate error fingerprint
 * Creates a unique identifier for an error based on its characteristics
 */
function generateErrorFingerprint(
  code: ErrorCode | string,
  discussionId?: string,
  operation?: string
): string {
  const parts = [
    code,
    discussionId || 'no-discussion',
    operation || 'unknown',
  ];
  return parts.join('::');
}

/**
 * Clean up expired error entries
 * Runs periodically to prevent memory leaks
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  const expiredKeys: string[] = [];

  for (const [key, entry] of errorStore.entries()) {
    // Remove entries older than the deduplication window
    if (now - entry.lastSeen > ERROR_DEDUPLICATION_WINDOW_MS) {
      expiredKeys.push(key);
    }
  }

  for (const key of expiredKeys) {
    errorStore.delete(key);
  }

  if (expiredKeys.length > 0) {
    logger.debug('Cleaned up expired error entries', {
      count: expiredKeys.length,
    });
  }
}

// Start periodic cleanup every 30 seconds
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredEntries, 30000);
}

/**
 * Check if error should be emitted (deduplication check)
 * @param code - Error code
 * @param discussionId - Optional discussion ID
 * @param operation - Operation name
 * @returns true if error should be emitted, false if it should be deduplicated
 */
export function shouldEmitError(
  code: ErrorCode | string,
  discussionId?: string,
  operation?: string
): boolean {
  const fingerprint = generateErrorFingerprint(code, discussionId, operation);
  const now = Date.now();
  const entry = errorStore.get(fingerprint);

  if (!entry) {
    // First occurrence - create entry and allow emission
    errorStore.set(fingerprint, {
      fingerprint,
      count: 1,
      firstSeen: now,
      lastSeen: now,
    });
    return true;
  }

  // Check if within throttle window
  const timeSinceLastSeen = now - entry.lastSeen;
  if (timeSinceLastSeen < ERROR_THROTTLE_WINDOW_MS) {
    // Within throttle window - deduplicate
    entry.count += 1;
    entry.lastSeen = now;
    logger.debug('Error deduplicated', {
      code,
      discussionId,
      operation,
      count: entry.count,
      timeSinceLastSeen,
    });
    return false;
  }

  // Outside throttle window - allow emission but update entry
  entry.count += 1;
  entry.lastSeen = now;
  return true;
}

/**
 * Get error deduplication statistics
 * Useful for monitoring and debugging
 */
export function getErrorDeduplicationStats(): {
  totalErrors: number;
  uniqueErrors: number;
  deduplicationRate: number;
  topErrors: Array<{ fingerprint: string; count: number }>;
} {
  const entries = Array.from(errorStore.values());
  const totalErrors = entries.reduce((sum, entry) => sum + entry.count, 0);
  const uniqueErrors = entries.length;
  const deduplicationRate =
    totalErrors > 0 ? (totalErrors - uniqueErrors) / totalErrors : 0;

  // Get top 10 most frequent errors
  const topErrors = entries
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((entry) => ({
      fingerprint: entry.fingerprint,
      count: entry.count,
    }));

  return {
    totalErrors,
    uniqueErrors,
    deduplicationRate,
    topErrors,
  };
}

/**
 * Clear error deduplication store
 * Useful for testing or manual cleanup
 */
export function clearErrorStore(): void {
  errorStore.clear();
  logger.info('Error deduplication store cleared');
}

/**
 * Emit error to room with deduplication (for broadcast errors)
 * @param io - Socket.IO Server instance
 * @param discussionId - Discussion ID (room name)
 * @param error - Error object
 * @param operation - Operation name
 */
export function emitErrorToRoomWithDeduplication(
  io: Server,
  discussionId: string,
  error: { code: string; message: string; [key: string]: unknown },
  operation?: string
): void {
  // Log error before deduplication check
  logger.error('Broadcast error occurred', {
    error: error.message,
    errorCode: error.code,
    discussionId,
    operation: operation || 'unknown',
  });

  if (shouldEmitError(error.code, discussionId, operation)) {
    io.to(discussionId).emit('error', {
      code: error.code,
      message: error.message,
      discussionId,
      ...(error.recoverable !== undefined && { recoverable: error.recoverable }),
    });
  } else {
    logger.debug('Broadcast error deduplicated, not emitting', {
      code: error.code,
      discussionId,
      operation,
    });
  }
}
