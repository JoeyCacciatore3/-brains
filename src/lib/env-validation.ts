interface ValidationResult {
  valid: boolean;
  missing: string[];
  errors: string[];
}

/**
 * Validate required environment variables
 * At least one LLM API key must be present
 * @returns ValidationResult with validation status
 */
export function validateEnvironment(): ValidationResult {
  const missing: string[] = [];
  const errors: string[] = [];

  // Check for at least one LLM API key
  const hasGroqKey = !!process.env.GROQ_API_KEY;
  const hasMistralKey = !!process.env.MISTRAL_API_KEY;
  const hasOpenRouterKey = !!process.env.OPENROUTER_API_KEY;

  if (!hasGroqKey && !hasMistralKey && !hasOpenRouterKey) {
    errors.push(
      'At least one LLM API key is required (GROQ_API_KEY, MISTRAL_API_KEY, or OPENROUTER_API_KEY)'
    );
  }

  // Optional but recommended variables
  if (!process.env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV === 'production') {
    errors.push('NEXT_PUBLIC_APP_URL is recommended in production');
  }

  // Validate Redis configuration if provided
  if (process.env.REDIS_URL && process.env.REDIS_HOST) {
    errors.push(
      'Cannot specify both REDIS_URL and REDIS_HOST. Use REDIS_URL for connection string or REDIS_HOST for individual settings.'
    );
  }

  // Validate OAuth configuration if provided
  const hasGithubClientId = !!process.env.GITHUB_CLIENT_ID;
  const hasGithubClientSecret = !!process.env.GITHUB_CLIENT_SECRET;
  const hasNextAuthSecret = !!process.env.NEXTAUTH_SECRET;

  // If any OAuth credentials are provided, validate they're complete
  if (hasGithubClientId || hasGithubClientSecret) {
    // NEXTAUTH_SECRET is required for OAuth
    if (!hasNextAuthSecret) {
      errors.push('NEXTAUTH_SECRET is required when OAuth credentials are provided');
    }

    // GitHub OAuth validation
    if (hasGithubClientId && !hasGithubClientSecret) {
      errors.push('GITHUB_CLIENT_SECRET is required when GITHUB_CLIENT_ID is set');
    }
    if (!hasGithubClientId && hasGithubClientSecret) {
      errors.push('GITHUB_CLIENT_ID is required when GITHUB_CLIENT_SECRET is set');
    }
  }

  // Validate rate limit configuration
  const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10', 10);
  if (isNaN(rateLimitMax) || rateLimitMax < 1) {
    errors.push('RATE_LIMIT_MAX_REQUESTS must be a positive number');
  }

  const rateLimitWindow = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
  if (isNaN(rateLimitWindow) || rateLimitWindow < 1000) {
    errors.push('RATE_LIMIT_WINDOW_MS must be at least 1000 (1 second)');
  }

  const valid = errors.length === 0;

  return {
    valid,
    missing,
    errors,
  };
}

/**
 * Validate environment and exit if critical variables are missing
 * Should be called at server startup
 */
import { logger } from './logger';

export function validateEnvironmentOrExit(): void {
  const result = validateEnvironment();

  if (!result.valid) {
    logger.error('Environment validation failed:');
    result.errors.forEach((error) => {
      logger.error(`  - ${error}`);
    });
    logger.error('\nPlease set the required environment variables and try again.');
    process.exit(1);
  }

  // Log warnings for optional but recommended variables
  if (!process.env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV !== 'production') {
    logger.warn('Warning: NEXT_PUBLIC_APP_URL is not set. Using default localhost URL.');
  }
}
