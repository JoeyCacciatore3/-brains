/**
 * Monitoring Dashboard Data Endpoint
 * Provides system health summary and metrics for dashboard
 */

import { NextResponse } from 'next/server';
import { getMetricsSnapshot } from '@/lib/monitoring/metrics';
import { getAllCircuitBreakerStats } from '@/lib/resilience/circuit-breaker';
import { getAllProviderHealth } from '@/lib/llm/provider-health';
import { getActiveAlerts } from '@/lib/alerting/alerts';
import { getCostByProvider, getDailyCosts } from '@/lib/cost-tracking/cost-calculator';
import { checkDailyCostBudget } from '@/lib/cost-tracking/optimizer';
import { getSystemLoad } from '@/lib/resilience/degradation';
import { checkDatabaseHealth } from '@/lib/db';
import { getRedisClient } from '@/lib/db/redis';
import { checkLLMProviderAvailability } from '@/lib/llm';
import { logger } from '@/lib/logger';

/**
 * GET /api/monitoring/dashboard
 */
export async function GET() {
  try {
    // Gather all metrics and health data
    const [
      metrics,
      circuitBreakers,
      providerHealth,
      alerts,
      costByProvider,
      costBudget,
      systemLoad,
      dbHealth,
      llmAvailability,
    ] = await Promise.all([
      Promise.resolve(getMetricsSnapshot()),
      Promise.resolve(getAllCircuitBreakerStats()),
      Promise.resolve(getAllProviderHealth()),
      Promise.resolve(getActiveAlerts()),
      Promise.resolve(getCostByProvider()),
      checkDailyCostBudget(),
      Promise.resolve(getSystemLoad()),
      Promise.resolve(checkDatabaseHealth()),
      checkLLMProviderAvailability(),
    ]);

    // Check Redis
    let redisHealth = false;
    try {
      const redis = getRedisClient();
      if (redis) {
        await redis.ping();
        redisHealth = true;
      }
    } catch {
      redisHealth = false;
    }

    // Calculate error rate
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
    const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

    // Get daily costs
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dailyCosts = getDailyCosts(today, tomorrow);

    const dashboard = {
      timestamp: new Date().toISOString(),
      health: {
        database: dbHealth,
        redis: redisHealth,
        llm: Object.values(llmAvailability).some((available) => available),
      },
      metrics: {
        errorRate,
        totalRequests,
        totalErrors,
        activeDiscussions: metrics.metrics['gauge:discussions:active']?.avg || 0,
        socketConnections: metrics.metrics['gauge:sockets:connections']?.avg || 0,
      },
      providers: {
        availability: llmAvailability,
        health: providerHealth,
      },
      circuitBreakers,
      alerts: alerts.map((alert) => ({
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        timestamp: alert.timestamp,
      })),
      costs: {
        byProvider: costByProvider,
        daily: dailyCosts,
        budget: {
          current: costBudget.currentCost,
          limit: costBudget.budget,
          percentage: costBudget.percentage,
          exceeded: costBudget.exceeded,
        },
      },
      system: {
        load: systemLoad,
      },
    };

    return NextResponse.json(dashboard);
  } catch (error) {
    logger.error('Failed to get dashboard data', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: 'Failed to get dashboard data',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
