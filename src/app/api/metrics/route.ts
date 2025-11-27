/**
 * Metrics Export Endpoint
 * Exports metrics in Prometheus format
 */

import { NextResponse } from 'next/server';
import { getMetricsSnapshot } from '@/lib/monitoring/metrics';
import { logger } from '@/lib/logger';

/**
 * GET /api/metrics
 * Returns metrics in Prometheus format
 */
export async function GET() {
  try {
    const metrics = getMetricsSnapshot();
    const lines: string[] = [];

    // Convert metrics to Prometheus format
    for (const [name, metric] of Object.entries(metrics.metrics)) {
      const metricName = name.replace(/[^a-zA-Z0-9_]/g, '_');

      // Export counter metrics
      if (name.startsWith('counter:')) {
        lines.push(`# TYPE ${metricName} counter`);
        lines.push(`${metricName} ${metric.sum}`);
      }

      // Export gauge metrics
      if (name.startsWith('gauge:')) {
        lines.push(`# TYPE ${metricName} gauge`);
        lines.push(`${metricName} ${metric.avg}`);
      }

      // Export timing metrics
      if (name.startsWith('timing:')) {
        lines.push(`# TYPE ${metricName} histogram`);
        lines.push(`${metricName}_sum ${metric.sum}`);
        lines.push(`${metricName}_count ${metric.count}`);
        lines.push(`${metricName}_avg ${metric.avg}`);
        if (metric.p50 !== undefined) {
          lines.push(`${metricName}_p50 ${metric.p50}`);
        }
        if (metric.p95 !== undefined) {
          lines.push(`${metricName}_p95 ${metric.p95}`);
        }
        if (metric.p99 !== undefined) {
          lines.push(`${metricName}_p99 ${metric.p99}`);
        }
      }
    }

    const prometheusFormat = lines.join('\n') + '\n';

    return new NextResponse(prometheusFormat, {
      headers: {
        'Content-Type': 'text/plain; version=0.0.4',
      },
    });
  } catch (error) {
    logger.error('Failed to export metrics', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: 'Failed to export metrics',
      },
      { status: 500 }
    );
  }
}
