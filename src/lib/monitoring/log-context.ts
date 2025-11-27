/**
 * Log Context Management
 * Adds correlation IDs and structured logging support
 */

import { randomBytes } from 'crypto';

const LOG_CORRELATION_ENABLED = process.env.LOG_CORRELATION_ENABLED !== 'false';
const LOG_SAMPLING_RATE = parseFloat(process.env.LOG_SAMPLING_RATE || '1.0');

// Store correlation IDs per async context (using AsyncLocalStorage would be better, but keeping it simple)
const correlationStore = new Map<string, string>();

/**
 * Generate a correlation ID
 */
export function generateCorrelationId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Get current correlation ID for a context
 */
export function getCorrelationId(contextId?: string): string | undefined {
  if (!LOG_CORRELATION_ENABLED) {
    return undefined;
  }

  if (contextId) {
    return correlationStore.get(contextId);
  }

  // Try to get from current async context (simplified)
  return undefined;
}

/**
 * Set correlation ID for a context
 */
export function setCorrelationId(contextId: string, correlationId: string): void {
  if (LOG_CORRELATION_ENABLED) {
    correlationStore.set(contextId, correlationId);
  }
}

/**
 * Clear correlation ID for a context
 */
export function clearCorrelationId(contextId: string): void {
  correlationStore.delete(contextId);
}

/**
 * Check if log should be sampled
 */
export function shouldSampleLog(): boolean {
  return Math.random() < LOG_SAMPLING_RATE;
}

/**
 * Enrich log context with standard fields
 */
export function enrichLogContext(
  context: Record<string, unknown>,
  options?: {
    operation?: string;
    discussionId?: string;
    userId?: string;
    duration?: number;
    correlationId?: string;
  }
): Record<string, unknown> {
  const enriched: Record<string, unknown> = { ...context };

  if (options?.operation) {
    enriched.operation = options.operation;
  }

  if (options?.discussionId) {
    enriched.discussionId = options.discussionId;
  }

  if (options?.userId) {
    enriched.userId = options.userId;
  }

  if (options?.duration !== undefined) {
    enriched.duration = options.duration;
  }

  if (options?.correlationId && LOG_CORRELATION_ENABLED) {
    enriched.correlationId = options.correlationId;
  }

  enriched.timestamp = new Date().toISOString();

  return enriched;
}

/**
 * Cleanup old correlation IDs (prevent memory leaks)
 */
function cleanupCorrelationIds(): void {
  // Simple cleanup - in production, use AsyncLocalStorage or similar
  // This is a simplified version
  if (correlationStore.size > 10000) {
    // Clear half of the oldest entries (simplified - would need timestamp tracking)
    const keys = Array.from(correlationStore.keys());
    const toDelete = keys.slice(0, Math.floor(keys.length / 2));
    for (const key of toDelete) {
      correlationStore.delete(key);
    }
  }
}

// Cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupCorrelationIds, 5 * 60 * 1000);
}
