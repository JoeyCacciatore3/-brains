/**
 * Health Check Endpoint
 * Comprehensive health checks for all system components
 */

import { NextResponse } from 'next/server';
import { checkDatabaseHealth } from '@/lib/db';
import { getRedisClient } from '@/lib/db/redis';
import { checkLLMProviderAvailability } from '@/lib/llm';
import { logger } from '@/lib/logger';
import { getMetricsSnapshot } from '@/lib/monitoring/metrics';
import { getMemoryStatistics } from '@/lib/memory-manager';
import os from 'os';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';

interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: Record<string, unknown>;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: HealthCheck;
    redis?: HealthCheck;
    llm: HealthCheck;
    disk: HealthCheck;
    memory: HealthCheck;
  };
  metrics?: {
    activeDiscussions?: number;
    socketConnections?: number;
  };
}

/**
 * Check database health
 */
async function checkDatabase(): Promise<HealthCheck> {
  try {
    const isHealthy = checkDatabaseHealth();
    if (isHealthy) {
      return { status: 'healthy' };
    }
    return {
      status: 'unhealthy',
      message: 'Database health check failed',
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      message: 'Database check error',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Check Redis health
 */
async function checkRedis(): Promise<HealthCheck> {
  const redis = getRedisClient();
  if (!redis) {
    return {
      status: 'degraded',
      message: 'Redis not configured (using in-memory fallback)',
    };
  }

  try {
    await redis.ping();
    return { status: 'healthy' };
  } catch (error) {
    return {
      status: 'degraded',
      message: 'Redis connection failed (using in-memory fallback)',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Check LLM provider health
 */
async function checkLLM(): Promise<HealthCheck> {
  try {
    const availability = await checkLLMProviderAvailability();
    const availableProviders = Object.entries(availability)
      .filter(([, available]) => available)
      .map(([provider]) => provider);

    if (availableProviders.length === 0) {
      return {
        status: 'unhealthy',
        message: 'No LLM providers available',
        details: {
          providers: availability,
        },
      };
    }

    if (availableProviders.length < 3) {
      return {
        status: 'degraded',
        message: 'Some LLM providers unavailable',
        details: {
          available: availableProviders,
          all: availability,
        },
      };
    }

    return {
      status: 'healthy',
      details: {
        providers: availability,
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      message: 'LLM provider check error',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Check disk space
 */
async function checkDisk(): Promise<HealthCheck> {
  try {
    const dbPath = process.env.DATABASE_PATH || 'data/conversations.db';
    const dbDir = path.dirname(dbPath);
    const discussionsDir = process.env.DISCUSSIONS_DIR || 'data/discussions';

    // Check if directories exist and are writable
    const dbDirExists = fs.existsSync(dbDir);
    let dbDirWritable = false;
    try {
      if (dbDirExists) {
        fs.accessSync(dbDir, fs.constants.W_OK);
        dbDirWritable = true;
      }
    } catch {
      dbDirWritable = false;
    }

    const discussionsDirExists = fs.existsSync(discussionsDir);
    let discussionsDirWritable = false;
    try {
      if (discussionsDirExists) {
        fs.accessSync(discussionsDir, fs.constants.W_OK);
        discussionsDirWritable = true;
      }
    } catch {
      discussionsDirWritable = false;
    }

    if (!dbDirWritable || !discussionsDirWritable) {
      return {
        status: 'unhealthy',
        message: 'Disk directories not writable',
        details: {
          dbDir: { exists: dbDirExists, writable: dbDirWritable },
          discussionsDir: { exists: discussionsDirExists, writable: discussionsDirWritable },
        },
      };
    }

    // Check disk space using statfs if available (Node.js 18+)
    const diskSpaceThreshold = parseFloat(process.env.DISK_SPACE_THRESHOLD || '0.1'); // Default 10% free space required
    let freeSpacePercent = 1.0;
    let totalBytes = 0;
    let freeBytes = 0;
    let hasSpaceInfo = false;

    try {
      // Try to use statfs (available in Node.js 18.15.0+)
      // Define proper type for statfs return value
      interface StatfsResult {
        bavail: number;
        blocks: number;
        bsize: number;
      }

      // Check if statfs method exists (runtime check)
      const statfsMethod = (fsPromises as { statfs?: (path: string) => Promise<StatfsResult> }).statfs;
      if (!statfsMethod) {
        logger.debug('statfs method not available in this Node.js version');
      } else {
        const stats = await statfsMethod(dbDirExists ? dbDir : discussionsDir);
        if (stats && typeof stats.bavail === 'number' && typeof stats.blocks === 'number') {
          totalBytes = stats.blocks * stats.bsize;
          freeBytes = stats.bavail * stats.bsize;
          if (totalBytes > 0) {
            freeSpacePercent = freeBytes / totalBytes;
            hasSpaceInfo = true;
          }
        }
      }
    } catch (statfsError) {
      // statfs not available or failed - fall back to directory checks only
      logger.debug('Disk space check via statfs not available', {
        error: statfsError instanceof Error ? statfsError.message : String(statfsError),
      });
    }

    const details: Record<string, unknown> = {
      dbDir: { exists: dbDirExists, writable: dbDirWritable },
      discussionsDir: { exists: discussionsDirExists, writable: discussionsDirWritable },
    };

    if (hasSpaceInfo) {
      details.freeSpacePercent = Math.round(freeSpacePercent * 100);
      details.freeSpaceGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(2);
      details.totalSpaceGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);

      if (freeSpacePercent < diskSpaceThreshold) {
        return {
          status: 'unhealthy',
          message: `Disk space critically low: ${Math.round(freeSpacePercent * 100)}% free (threshold: ${Math.round(diskSpaceThreshold * 100)}%)`,
          details,
        };
      }

      if (freeSpacePercent < diskSpaceThreshold * 2) {
        return {
          status: 'degraded',
          message: `Disk space low: ${Math.round(freeSpacePercent * 100)}% free`,
          details,
        };
      }
    }

    return {
      status: 'healthy',
      details,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      message: 'Disk check error',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Check memory usage
 */
async function checkMemory(): Promise<HealthCheck> {
  try {
    // Use memory manager for detailed heap statistics
    const heapStats = getMemoryStatistics();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const systemMemoryUsage = usedMemory / totalMemory;

    // Use heap percentage for application memory health (more relevant than system memory)
    const heapUsage = heapStats.heapPercent;

    // Warn if heap usage is above thresholds
    if (heapUsage > 0.9) {
      return {
        status: 'unhealthy',
        message: 'Memory usage critically high',
        details: {
          heapPercent: heapStats.heapPercentRounded,
          heapUsedMB: heapStats.heapUsedMB,
          heapTotalMB: heapStats.heapTotalMB,
          systemMemoryPercent: Math.round(systemMemoryUsage * 100),
          externalMB: heapStats.externalMB,
          rssMB: heapStats.rssMB,
        },
      };
    }

    if (heapUsage > 0.8) {
      return {
        status: 'degraded',
        message: 'Memory usage high',
        details: {
          heapPercent: heapStats.heapPercentRounded,
          heapUsedMB: heapStats.heapUsedMB,
          heapTotalMB: heapStats.heapTotalMB,
          systemMemoryPercent: Math.round(systemMemoryUsage * 100),
          externalMB: heapStats.externalMB,
          rssMB: heapStats.rssMB,
        },
      };
    }

    return {
      status: 'healthy',
      details: {
        heapPercent: heapStats.heapPercentRounded,
        heapUsedMB: heapStats.heapUsedMB,
        heapTotalMB: heapStats.heapTotalMB,
        systemMemoryPercent: Math.round(systemMemoryUsage * 100),
        externalMB: heapStats.externalMB,
        rssMB: heapStats.rssMB,
      },
    };
  } catch (error) {
    return {
      status: 'degraded',
      message: 'Memory check error',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Determine overall health status
 */
function determineOverallStatus(checks: HealthResponse['checks']): 'healthy' | 'degraded' | 'unhealthy' {
  const statuses = Object.values(checks).map((check) => check.status);

  if (statuses.some((s) => s === 'unhealthy')) {
    return 'unhealthy';
  }

  if (statuses.some((s) => s === 'degraded')) {
    return 'degraded';
  }

  return 'healthy';
}

/**
 * GET /api/health
 */
export async function GET() {
  try {
    const [database, redis, llm, disk, memory] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkLLM(),
      checkDisk(),
      checkMemory(),
    ]);

    const checks: HealthResponse['checks'] = {
      database,
      llm,
      disk,
      memory,
    };

    // Include Redis check if configured
    if (process.env.REDIS_URL || process.env.REDIS_HOST) {
      checks.redis = redis;
    }

    const overallStatus = determineOverallStatus(checks);

    const response: HealthResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks,
    };

    // Add metrics if available
    try {
      const metrics = getMetricsSnapshot();
      const activeDiscussions = metrics.metrics['gauge:discussions:active']?.avg;
      const socketConnections = metrics.metrics['gauge:sockets:connections']?.avg;

      if (activeDiscussions !== undefined || socketConnections !== undefined) {
        response.metrics = {};
        if (activeDiscussions !== undefined) {
          response.metrics.activeDiscussions = Math.round(activeDiscussions);
        }
        if (socketConnections !== undefined) {
          response.metrics.socketConnections = Math.round(socketConnections);
        }
      }
    } catch (error) {
      logger.warn('Failed to get metrics for health check', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;

    return NextResponse.json(response, { status: statusCode });
  } catch (error) {
    logger.error('Health check failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        status: 'unhealthy' as const,
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
      },
      { status: 503 }
    );
  }
}
