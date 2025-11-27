/**
 * Metrics Collection System
 * Collects and aggregates system metrics for monitoring
 */

import { logger } from '@/lib/logger';
import { getRedisClient } from '@/lib/db/redis';

export interface MetricValue {
  value: number;
  timestamp: number;
}

export interface MetricData {
  name: string;
  values: MetricValue[];
  sum: number;
  count: number;
  min: number;
  max: number;
  avg: number;
  // Percentiles for timing/histogram metrics
  p50?: number;
  p95?: number;
  p99?: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  metrics: Record<string, MetricData>;
}

const METRICS_ENABLED = process.env.METRICS_ENABLED !== 'false';
const METRICS_RETENTION_HOURS = parseInt(process.env.METRICS_RETENTION_HOURS || '24', 10);
const METRICS_AGGREGATION_INTERVAL_MS = parseInt(
  process.env.METRICS_AGGREGATION_INTERVAL_MS || '60000',
  10
);

// In-memory metrics store
const metricsStore = new Map<string, MetricValue[]>();

/**
 * Add a metric value
 */
export function recordMetric(name: string, value: number): void {
  if (!METRICS_ENABLED) {
    return;
  }

  const timestamp = Date.now();
  const key = name;

  // Get or create metric array
  let values = metricsStore.get(key);
  if (!values) {
    values = [];
    metricsStore.set(key, values);
  }

  // Add new value
  values.push({ value, timestamp });

  // Clean up old values (beyond retention period)
  const retentionMs = METRICS_RETENTION_HOURS * 60 * 60 * 1000;
  const cutoffTime = timestamp - retentionMs;
  const filtered = values.filter((v) => v.timestamp > cutoffTime);
  metricsStore.set(key, filtered);

  // Store in Redis if available (for distributed deployments)
  const redis = getRedisClient();
  if (redis) {
    const redisKey = `metrics:${name}`;
    redis
      .zadd(redisKey, timestamp, JSON.stringify({ value, timestamp }))
      .catch((error) => {
        logger.error('Failed to store metric in Redis', {
          error: error instanceof Error ? error.message : String(error),
          metric: name,
        });
      });

    // Set expiration
    redis.pexpire(redisKey, retentionMs).catch(() => {
      // Ignore expiration errors
    });
  }
}

/**
 * Get metric statistics
 */
export function getMetricStats(name: string, windowMs?: number): MetricData | null {
  const values = metricsStore.get(name);
  if (!values || values.length === 0) {
    return null;
  }

  let filteredValues = values;
  if (windowMs) {
    const cutoffTime = Date.now() - windowMs;
    filteredValues = values.filter((v) => v.timestamp > cutoffTime);
  }

  if (filteredValues.length === 0) {
    return null;
  }

  const sum = filteredValues.reduce((acc, v) => acc + v.value, 0);
  const count = filteredValues.length;
  const min = Math.min(...filteredValues.map((v) => v.value));
  const max = Math.max(...filteredValues.map((v) => v.value));
  const avg = sum / count;

  // Calculate percentiles
  const sorted = [...filteredValues].sort((a, b) => a.value - b.value);
  const p50 = sorted[Math.floor(sorted.length * 0.5)]?.value || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]?.value || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)]?.value || 0;

  return {
    name,
    values: filteredValues,
    sum,
    count,
    min,
    max,
    avg,
    p50,
    p95,
    p99,
  } as MetricData & { p50: number; p95: number; p99: number };
}

/**
 * Get all metrics
 */
export function getAllMetrics(windowMs?: number): Record<string, MetricData> {
  const result: Record<string, MetricData> = {};

  for (const name of metricsStore.keys()) {
    const stats = getMetricStats(name, windowMs);
    if (stats) {
      result[name] = stats;
    }
  }

  return result;
}

/**
 * Increment a counter metric
 */
export function incrementCounter(name: string, value: number = 1): void {
  recordMetric(`counter:${name}`, value);
}

/**
 * Record a timing metric (duration in milliseconds)
 */
export function recordTiming(name: string, durationMs: number): void {
  recordMetric(`timing:${name}`, durationMs);
}

/**
 * Record a gauge metric (current value)
 */
export function recordGauge(name: string, value: number): void {
  recordMetric(`gauge:${name}`, value);
}

/**
 * Get metrics snapshot
 */
export function getMetricsSnapshot(windowMs?: number): MetricsSnapshot {
  return {
    timestamp: Date.now(),
    metrics: getAllMetrics(windowMs),
  };
}

/**
 * Clear all metrics
 */
export function clearMetrics(): void {
  metricsStore.clear();
  logger.info('Metrics cleared');
}

/**
 * Periodic cleanup of expired metrics
 */
function cleanupExpiredMetrics(): void {
  if (!METRICS_ENABLED) {
    return;
  }

  const retentionMs = METRICS_RETENTION_HOURS * 60 * 60 * 1000;
  const cutoffTime = Date.now() - retentionMs;
  let keysRemoved = 0;
  let valuesRemoved = 0;

  for (const [key, values] of metricsStore.entries()) {
    const filtered = values.filter((v) => v.timestamp > cutoffTime);
    if (filtered.length === 0) {
      metricsStore.delete(key);
      keysRemoved++;
    } else if (filtered.length < values.length) {
      metricsStore.set(key, filtered);
      valuesRemoved += values.length - filtered.length;
    }
  }

  if (keysRemoved > 0 || valuesRemoved > 0) {
    logger.debug('Cleaned up expired metrics', {
      keysRemoved,
      valuesRemoved,
      remainingMetrics: metricsStore.size,
    });
  }
}

/**
 * Aggregate metrics (called periodically)
 */
async function aggregateMetrics(): Promise<void> {
  if (!METRICS_ENABLED) {
    return;
  }

  try {
    // Aggregate metrics from Redis if available
    const redis = getRedisClient();
    if (redis) {
      // This would aggregate distributed metrics
      // Implementation depends on specific aggregation needs
    }

    logger.debug('Metrics aggregated', {
      metricCount: metricsStore.size,
    });
  } catch (error) {
    logger.error('Failed to aggregate metrics', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Start periodic aggregation
if (typeof setInterval !== 'undefined' && METRICS_ENABLED) {
  setInterval(aggregateMetrics, METRICS_AGGREGATION_INTERVAL_MS);
  // Start periodic cleanup every 15 minutes
  setInterval(cleanupExpiredMetrics, 15 * 60 * 1000);
}
