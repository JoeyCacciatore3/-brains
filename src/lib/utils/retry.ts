/**
 * Retry Logic with Exponential Backoff
 * Handles transient errors with automatic retry
 */

import { logger } from '@/lib/logger';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterEnabled?: boolean;
  retryable?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || '3', 10),
  baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS || '1000', 10),
  maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS || '30000', 10),
  jitterEnabled: process.env.RETRY_JITTER_ENABLED !== 'false',
  retryable: () => true,
};

/**
 * Check if an error is retryable
 * Default implementation checks for common retryable error conditions
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const code = (error as { code?: string }).code;

    // Network errors are retryable
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
      return true;
    }

    // HTTP status codes that are retryable
    if (code === '429' || code === '503' || code === '502' || code === '504') {
      return true;
    }

    // Error messages indicating retryable conditions
    if (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('temporarily unavailable') ||
      message.includes('rate limit') ||
      message.includes('service unavailable')
    ) {
      return true;
    }
  }

  // Check for HTTP response status codes
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: number }).status;
    if (status === 429 || status === 503 || status === 502 || status === 504) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an error is NOT retryable (permanent)
 */
export function isPermanentError(error: unknown): boolean {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    const message = error.message.toLowerCase();

    // HTTP status codes that are permanent
    if (code === '400' || code === '401' || code === '403' || code === '404') {
      return true;
    }

    // Error messages indicating permanent conditions
    if (
      message.includes('invalid') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('not found') ||
      message.includes('bad request')
    ) {
      return true;
    }
  }

  // Check for HTTP response status codes
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: number }).status;
    if (status === 400 || status === 401 || status === 403 || status === 404) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
  // Exponential backoff: baseDelay * 2^(attempt-1)
  const exponentialDelay = options.baseDelayMs * Math.pow(2, attempt - 1);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);

  // Add jitter if enabled (random value between 0 and 20% of delay)
  if (options.jitterEnabled) {
    const jitter = Math.random() * cappedDelay * 0.2;
    return Math.floor(cappedDelay + jitter);
  }

  return Math.floor(cappedDelay);
}

/**
 * Retry a function with exponential backoff
 * @param fn - Function to retry
 * @param options - Retry options
 * @returns Promise that resolves with the function result or rejects after max attempts
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts: Required<RetryOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
    retryable: options.retryable || DEFAULT_OPTIONS.retryable,
  };

  let lastError: unknown;
  const startTime = Date.now();

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await fn();
      const duration = Date.now() - startTime;

      if (attempt > 1) {
        logger.info('Retry succeeded', {
          attempt,
          totalAttempts: attempt,
          duration,
        });
      }

      return result;
    } catch (error) {
      lastError = error;

      // Check if error is permanent (should not retry)
      if (isPermanentError(error)) {
        logger.warn('Permanent error encountered, not retrying', {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      // Check if error is retryable
      const shouldRetry = opts.retryable(error) && isRetryableError(error);

      if (!shouldRetry) {
        logger.warn('Non-retryable error encountered', {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      // If this is the last attempt, throw the error
      if (attempt >= opts.maxAttempts) {
        logger.error('Max retry attempts reached', {
          maxAttempts: opts.maxAttempts,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      // Calculate delay and wait
      const delay = calculateDelay(attempt, opts);
      logger.info('Retrying after error', {
        attempt,
        maxAttempts: opts.maxAttempts,
        delay,
        error: error instanceof Error ? error.message : String(error),
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Retry context for tracking retry attempts
 */
export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  lastError?: unknown;
  startTime: number;
}

/**
 * Create a retry context
 */
export function createRetryContext(maxAttempts?: number): RetryContext {
  return {
    attempt: 0,
    maxAttempts: maxAttempts || DEFAULT_OPTIONS.maxAttempts,
    startTime: Date.now(),
  };
}
