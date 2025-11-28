/**
 * Alert System
 * Monitors system conditions and triggers alerts
 */

import { logger } from '@/lib/logger';
import { getMetricsSnapshot } from '@/lib/monitoring/metrics';
import { getAllCircuitBreakerStats } from '@/lib/resilience/circuit-breaker';
import { checkDailyCostBudget } from '@/lib/cost-tracking/optimizer';
import { getSystemLoad } from '@/lib/resilience/degradation';
import { checkDatabaseHealth } from '@/lib/db';
import { getRedisClient } from '@/lib/db/redis';
import { checkLLMProviderAvailability } from '@/lib/llm';
import fs from 'fs';
import path from 'path';

const ALERTS_ENABLED = process.env.ALERTS_ENABLED !== 'false';
const ALERT_ERROR_RATE_THRESHOLD = parseFloat(process.env.ALERT_ERROR_RATE_THRESHOLD || '0.05');
// Note: ALERT_DISK_SPACE_THRESHOLD parsed but not used (kept for future disk space monitoring)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ALERT_DISK_SPACE_THRESHOLD = parseFloat(process.env.ALERT_DISK_SPACE_THRESHOLD || '0.1');

export interface Alert {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

const activeAlerts = new Map<string, Alert>();

/**
 * Check error rate
 */
async function checkErrorRate(): Promise<Alert | null> {
  const metrics = getMetricsSnapshot(5 * 60 * 1000); // Last 5 minutes

  let totalRequests = 0;
  let totalErrors = 0;

  for (const [name, metric] of Object.entries(metrics.metrics)) {
    if (name.includes('requests:') && name.includes(':total')) {
      totalRequests += metric.sum;
    }
    if (name.includes('errors:')) {
      totalErrors += metric.sum;
    }
  }

  if (totalRequests === 0) {
    return null;
  }

  const errorRate = totalErrors / totalRequests;
  if (errorRate > ALERT_ERROR_RATE_THRESHOLD) {
    return {
      id: 'error-rate-high',
      type: 'error-rate',
      severity: errorRate > 0.2 ? 'critical' : errorRate > 0.1 ? 'high' : 'medium',
      message: `High error rate: ${(errorRate * 100).toFixed(1)}%`,
      timestamp: Date.now(),
      details: {
        errorRate,
        totalRequests,
        totalErrors,
        threshold: ALERT_ERROR_RATE_THRESHOLD,
      },
    };
  }

  return null;
}

/**
 * Check provider availability
 */
async function checkProviderAvailability(): Promise<Alert | null> {
  const availability = await checkLLMProviderAvailability();
  const availableProviders = Object.entries(availability)
    .filter(([, available]) => available)
    .map(([provider]) => provider);

  if (availableProviders.length === 0) {
    return {
      id: 'no-providers-available',
      type: 'provider-availability',
      severity: 'critical',
      message: 'No LLM providers available',
      timestamp: Date.now(),
      details: {
        providers: availability,
      },
    };
  }

  if (availableProviders.length < 3) {
    return {
      id: 'some-providers-unavailable',
      type: 'provider-availability',
      severity: 'high',
      message: `Only ${availableProviders.length} of 3 providers available`,
      timestamp: Date.now(),
      details: {
        available: availableProviders,
        all: availability,
      },
    };
  }

  return null;
}

/**
 * Check circuit breakers
 */
function checkCircuitBreakers(): Alert | null {
  const stats = getAllCircuitBreakerStats();
  const openBreakers = Object.entries(stats).filter(([, stat]) => stat.state === 'open');

  if (openBreakers.length > 0) {
    return {
      id: 'circuit-breakers-open',
      type: 'circuit-breaker',
      severity: openBreakers.length >= 2 ? 'critical' : 'high',
      message: `${openBreakers.length} circuit breaker(s) open`,
      timestamp: Date.now(),
      details: {
        openBreakers: openBreakers.map(([name, stat]) => ({
          name,
          failures: stat.failures,
          openedAt: stat.openedAt,
        })),
      },
    };
  }

  return null;
}

/**
 * Check database health
 */
function checkDatabase(): Alert | null {
  const isHealthy = checkDatabaseHealth();
  if (!isHealthy) {
    return {
      id: 'database-unhealthy',
      type: 'database',
      severity: 'critical',
      message: 'Database health check failed',
      timestamp: Date.now(),
    };
  }

  return null;
}

/**
 * Check Redis health
 */
async function checkRedis(): Promise<Alert | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null; // Redis not configured, not an alert
  }

  try {
    await redis.ping();
    return null;
  } catch (error) {
    return {
      id: 'redis-unavailable',
      type: 'redis',
      severity: 'high',
      message: 'Redis connection failed',
      timestamp: Date.now(),
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Check disk space
 */
function checkDiskSpace(): Alert | null {
  try {
    const dbPath = process.env.DATABASE_PATH || 'data/conversations.db';
    const dbDir = path.dirname(dbPath);

    // Check if directory is writable (simplified check)
    try {
      fs.accessSync(dbDir, fs.constants.W_OK);
    } catch {
      return {
        id: 'disk-not-writable',
        type: 'disk',
        severity: 'critical',
        message: 'Database directory not writable',
        timestamp: Date.now(),
        details: {
          path: dbDir,
        },
      };
    }

    // Note: Actual disk space check would require more sophisticated implementation
    // This is a simplified version
    return null;
  } catch (error) {
    return {
      id: 'disk-check-error',
      type: 'disk',
      severity: 'medium',
      message: 'Disk space check failed',
      timestamp: Date.now(),
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Check cost threshold
 */
async function checkCostThreshold(): Promise<Alert | null> {
  const budgetCheck = await checkDailyCostBudget();
  if (budgetCheck.exceeded) {
    return {
      id: 'cost-budget-exceeded',
      type: 'cost',
      severity: 'high',
      message: `Daily cost budget exceeded: $${budgetCheck.currentCost.toFixed(2)} / $${budgetCheck.budget.toFixed(2)}`,
      timestamp: Date.now(),
      details: {
        currentCost: budgetCheck.currentCost,
        budget: budgetCheck.budget,
        percentage: budgetCheck.percentage,
      },
    };
  }

  if (budgetCheck.percentage >= 0.8) {
    return {
      id: 'cost-budget-warning',
      type: 'cost',
      severity: 'medium',
      message: `Daily cost budget warning: ${(budgetCheck.percentage * 100).toFixed(1)}% used`,
      timestamp: Date.now(),
      details: {
        currentCost: budgetCheck.currentCost,
        budget: budgetCheck.budget,
        percentage: budgetCheck.percentage,
      },
    };
  }

  return null;
}

/**
 * Check system load
 */
function checkSystemLoad(): Alert | null {
  const load = getSystemLoad();

  if (load.memoryUsage > 0.9 || load.cpuUsage > 0.9) {
    return {
      id: 'system-load-high',
      type: 'system-load',
      severity: 'high',
      message: `System load high: CPU ${(load.cpuUsage * 100).toFixed(1)}%, Memory ${(load.memoryUsage * 100).toFixed(1)}%`,
      timestamp: Date.now(),
      details: {
        cpuUsage: load.cpuUsage,
        memoryUsage: load.memoryUsage,
        activeRequests: load.activeRequests,
      },
    };
  }

  return null;
}

/**
 * Run all alert checks
 */
export async function checkAlerts(): Promise<Alert[]> {
  if (!ALERTS_ENABLED) {
    return [];
  }

  const alerts: Alert[] = [];

  // Run all checks
  const checks = await Promise.all([
    checkErrorRate(),
    checkProviderAvailability(),
    Promise.resolve(checkCircuitBreakers()),
    Promise.resolve(checkDatabase()),
    checkRedis(),
    Promise.resolve(checkDiskSpace()),
    checkCostThreshold(),
    Promise.resolve(checkSystemLoad()),
  ]);

  // Collect non-null alerts
  for (const alert of checks) {
    if (alert) {
      alerts.push(alert);
      activeAlerts.set(alert.id, alert);
    }
  }

  // Remove resolved alerts
  const alertIds = new Set(alerts.map((a) => a.id));
  for (const [id] of activeAlerts.entries()) {
    if (!alertIds.has(id)) {
      activeAlerts.delete(id);
    }
  }

  // Log alerts
  for (const alert of alerts) {
    if (alert.severity === 'critical' || alert.severity === 'high') {
      logger.error('Alert triggered', alert);
    } else {
      logger.warn('Alert triggered', alert);
    }
  }

  return alerts;
}

/**
 * Get active alerts
 */
export function getActiveAlerts(): Alert[] {
  return Array.from(activeAlerts.values());
}

/**
 * Clear alert
 */
export function clearAlert(alertId: string): void {
  activeAlerts.delete(alertId);
}

// Run alert checks every minute
if (typeof setInterval !== 'undefined' && ALERTS_ENABLED) {
  setInterval(() => {
    checkAlerts().catch((error) => {
      logger.error('Alert check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 60 * 1000);
}
