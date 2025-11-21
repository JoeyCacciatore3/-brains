import { NextResponse } from 'next/server';
import { checkDatabaseHealth } from '@/lib/db';
import { getRedisClient } from '@/lib/db/redis';
import { getLLMProvider } from '@/lib/llm';

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  checks: {
    database: {
      status: 'healthy' | 'unhealthy';
      message?: string;
    };
    llm: {
      status: 'healthy' | 'unhealthy';
      message?: string;
      providers: string[];
    };
    redis?: {
      status: 'healthy' | 'unhealthy' | 'not_configured';
      message?: string;
    };
  };
  timestamp: string;
}

export async function GET() {
  const checks: HealthCheckResult['checks'] = {
    database: { status: 'unhealthy' },
    llm: { status: 'unhealthy', providers: [] },
  };

  // Check database connectivity
  try {
    const dbHealthy = checkDatabaseHealth();
    checks.database = {
      status: dbHealthy ? 'healthy' : 'unhealthy',
      message: dbHealthy
        ? 'Database connection is healthy'
        : 'Database connection failed - check database file permissions and path configuration',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    checks.database = {
      status: 'unhealthy',
      message: `Database check failed: ${errorMessage}. Verify DATABASE_PATH environment variable and file permissions.`,
    };
  }

  // Check LLM provider availability (at least one must be available)
  const availableProviders: string[] = [];
  const providerChecks = [
    { name: 'groq', key: 'GROQ_API_KEY' },
    { name: 'mistral', key: 'MISTRAL_API_KEY' },
    { name: 'openrouter', key: 'OPENROUTER_API_KEY' },
  ];

  for (const provider of providerChecks) {
    try {
      if (process.env[provider.key]) {
        getLLMProvider(provider.name as 'groq' | 'mistral' | 'openrouter');
        availableProviders.push(provider.name);
      }
    } catch {
      // Provider not available or misconfigured - silently skip
    }
  }

  checks.llm = {
    status: availableProviders.length > 0 ? 'healthy' : 'unhealthy',
    message:
      availableProviders.length > 0
        ? `LLM providers available: ${availableProviders.join(', ')}`
        : 'No LLM providers available',
    providers: availableProviders,
  };

  // Check Redis connectivity (optional) with timeout
  const redisClient = getRedisClient();
  if (redisClient) {
    try {
      // Add timeout to prevent hanging
      const pingPromise = redisClient.ping();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Redis ping timeout')), 2000)
      );
      await Promise.race([pingPromise, timeoutPromise]);
      checks.redis = {
        status: 'healthy',
        message: 'Redis connection is healthy',
      };
    } catch (error) {
      checks.redis = {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Redis connection failed',
      };
    }
  } else {
    checks.redis = {
      status: 'not_configured',
      message: 'Redis is not configured (optional)',
    };
  }

  // Determine overall status
  const isHealthy = checks.database.status === 'healthy' && checks.llm.status === 'healthy';

  const result: HealthCheckResult = {
    status: isHealthy ? 'healthy' : 'unhealthy',
    checks,
    timestamp: new Date().toISOString(),
  };

  // Return appropriate status code
  return NextResponse.json(result, {
    status: isHealthy ? 200 : 503,
  });
}
