/**
 * Configuration Validation
 * Validates environment variables and configuration on startup
 */

import { logger } from '@/lib/logger';

export interface ValidationError {
  key: string;
  message: string;
  value?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Validate configuration
 */
export function validateConfiguration(): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Validate required LLM API keys
  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasMistral = !!process.env.MISTRAL_API_KEY;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;

  if (!hasGroq && !hasMistral && !hasOpenRouter) {
    errors.push({
      key: 'LLM_API_KEYS',
      message: 'At least one LLM API key is required (GROQ_API_KEY, MISTRAL_API_KEY, or OPENROUTER_API_KEY)',
    });
  }

  // Validate NEXTAUTH_SECRET in production
  if (process.env.NODE_ENV === 'production' && !process.env.NEXTAUTH_SECRET) {
    errors.push({
      key: 'NEXTAUTH_SECRET',
      message: 'NEXTAUTH_SECRET is required in production',
    });
  }

  // Validate numeric configurations
  const numericConfigs = [
    { key: 'RATE_LIMIT_MAX_REQUESTS', default: '10', min: 1, max: 1000 },
    { key: 'RATE_LIMIT_WINDOW_MS', default: '60000', min: 1000, max: 3600000 },
    { key: 'MAX_TURNS', default: '20', min: 1, max: 100 },
    { key: 'DISCUSSION_TOKEN_LIMIT', default: '4000', min: 1000, max: 8000 },
    { key: 'MAX_TOKENS', default: '2000', min: 500, max: 8192 },
  ];

  for (const config of numericConfigs) {
    const value = process.env[config.key];
    if (value) {
      const num = parseInt(value, 10);
      if (isNaN(num)) {
        errors.push({
          key: config.key,
          message: `Invalid numeric value: ${value}`,
          value,
        });
      } else if (num < config.min || num > config.max) {
        warnings.push({
          key: config.key,
          message: `Value ${num} is outside recommended range (${config.min}-${config.max})`,
          value: String(num),
        });
      }
    }
  }

  // Validate URL configurations
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      new URL(process.env.NEXT_PUBLIC_APP_URL);
    } catch {
      errors.push({
        key: 'NEXT_PUBLIC_APP_URL',
        message: 'Invalid URL format',
        value: process.env.NEXT_PUBLIC_APP_URL,
      });
    }
  }

  // Validate Redis configuration
  if (process.env.REDIS_URL && process.env.REDIS_HOST) {
    warnings.push({
      key: 'REDIS_CONFIG',
      message: 'Both REDIS_URL and REDIS_HOST are set. REDIS_URL takes precedence.',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Log validation results
 */
export function logValidationResults(result: ValidationResult): void {
  if (result.errors.length > 0) {
    logger.error('Configuration validation failed', {
      errors: result.errors,
    });
  }

  if (result.warnings.length > 0) {
    logger.warn('Configuration validation warnings', {
      warnings: result.warnings,
    });
  }

  if (result.valid && result.warnings.length === 0) {
    logger.info('Configuration validation passed');
  }
}

/**
 * Validate and log configuration on startup
 */
export function validateAndLogConfiguration(): ValidationResult {
  const result = validateConfiguration();
  logValidationResults(result);
  return result;
}
