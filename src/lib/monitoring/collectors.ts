/**
 * Metrics Collectors
 * Predefined collectors for common metrics
 */

import {
  recordMetric,
  incrementCounter,
  recordTiming,
  recordGauge,
} from './metrics';

/**
 * Record request metrics
 */
export function recordRequestMetrics(
  operation: string,
  durationMs: number,
  success: boolean
): void {
  incrementCounter(`requests:${operation}:total`);
  if (success) {
    incrementCounter(`requests:${operation}:success`);
  } else {
    incrementCounter(`requests:${operation}:error`);
  }
  recordTiming(`requests:${operation}:duration`, durationMs);
}

/**
 * Record error metrics
 */
export function recordErrorMetrics(
  errorCode: string,
  operation: string
): void {
  incrementCounter(`errors:${errorCode}`);
  incrementCounter(`errors:${operation}:${errorCode}`);
}

/**
 * Record LLM API metrics
 */
export function recordLLMMetrics(
  provider: string,
  durationMs: number,
  inputTokens: number,
  outputTokens: number,
  success: boolean
): void {
  incrementCounter(`llm:${provider}:requests:total`);
  if (success) {
    incrementCounter(`llm:${provider}:requests:success`);
  } else {
    incrementCounter(`llm:${provider}:requests:error`);
  }
  recordTiming(`llm:${provider}:duration`, durationMs);
  recordMetric(`llm:${provider}:tokens:input`, inputTokens);
  recordMetric(`llm:${provider}:tokens:output`, outputTokens);
  recordMetric(`llm:${provider}:tokens:total`, inputTokens + outputTokens);
}

/**
 * Record rate limit metrics
 */
export function recordRateLimitMetrics(
  operation: string,
  exceeded: boolean
): void {
  incrementCounter(`rate_limit:${operation}:checks`);
  if (exceeded) {
    incrementCounter(`rate_limit:${operation}:exceeded`);
  }
}

/**
 * Record retry metrics
 */
export function recordRetryMetrics(
  operation: string,
  attempt: number,
  success: boolean
): void {
  incrementCounter(`retry:${operation}:attempts`);
  if (success) {
    incrementCounter(`retry:${operation}:success`);
  } else {
    incrementCounter(`retry:${operation}:failed`);
  }
  recordMetric(`retry:${operation}:attempt_count`, attempt);
}

/**
 * Record active discussions count
 */
export function recordActiveDiscussions(count: number): void {
  recordGauge('discussions:active', count);
}

/**
 * Record socket connection count
 */
export function recordSocketConnections(count: number): void {
  recordGauge('sockets:connections', count);
}

/**
 * Record database query metrics
 */
export function recordDatabaseMetrics(
  operation: string,
  durationMs: number,
  success: boolean
): void {
  incrementCounter(`database:${operation}:total`);
  if (success) {
    incrementCounter(`database:${operation}:success`);
  } else {
    incrementCounter(`database:${operation}:error`);
  }
  recordTiming(`database:${operation}:duration`, durationMs);
}
