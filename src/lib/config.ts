/**
 * Centralized configuration constants
 * All environment variable defaults and application constants
 */

import { logger } from '@/lib/logger';

/**
 * Rate limiting configuration
 * In development mode, limits are more lenient to allow easier testing
 */
const isDevelopment = process.env.NODE_ENV !== 'production';

export const RATE_LIMIT_CONFIG = {
  MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || (isDevelopment ? '100' : '10'), 10),
  WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  // Operation-specific rate limits (more lenient in development)
  START_DIALOGUE: parseInt(process.env.RATE_LIMIT_START_DIALOGUE || (isDevelopment ? '50' : '3'), 10),
  PROCEED_DIALOGUE: parseInt(process.env.RATE_LIMIT_PROCEED_DIALOGUE || (isDevelopment ? '100' : '10'), 10),
  SUBMIT_ANSWERS: parseInt(process.env.RATE_LIMIT_SUBMIT_ANSWERS || (isDevelopment ? '100' : '10'), 10),
  GENERATE_QUESTIONS: parseInt(process.env.RATE_LIMIT_GENERATE_QUESTIONS || (isDevelopment ? '50' : '5'), 10),
  GENERATE_SUMMARY: parseInt(process.env.RATE_LIMIT_GENERATE_SUMMARY || (isDevelopment ? '20' : '2'), 10),
} as const;

/**
 * Rate limiting tiers configuration
 * Defines different rate limits based on user authentication status
 */
export const RATE_LIMIT_TIERS = {
  anonymous: {
    max: parseInt(process.env.RATE_LIMIT_TIER_ANONYMOUS_MAX || (isDevelopment ? '100' : '3'), 10),
    window: parseInt(process.env.RATE_LIMIT_TIER_ANONYMOUS_WINDOW_MS || '60000', 10),
  },
  authenticated: {
    max: parseInt(process.env.RATE_LIMIT_TIER_AUTHENTICATED_MAX || (isDevelopment ? '200' : '10'), 10),
    window: parseInt(process.env.RATE_LIMIT_TIER_AUTHENTICATED_WINDOW_MS || '60000', 10),
  },
  premium: {
    max: parseInt(process.env.RATE_LIMIT_TIER_PREMIUM_MAX || (isDevelopment ? '500' : '50'), 10),
    window: parseInt(process.env.RATE_LIMIT_TIER_PREMIUM_WINDOW_MS || '60000', 10),
  },
} as const;

export type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;

/**
 * Error handling configuration
 */
export const ERROR_CONFIG = {
  DEDUPLICATION_WINDOW_MS: parseInt(process.env.ERROR_DEDUPLICATION_WINDOW_MS || '5000', 10),
  THROTTLE_WINDOW_MS: parseInt(process.env.ERROR_THROTTLE_WINDOW_MS || '5000', 10),
} as const;

/**
 * Retry configuration
 */
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: parseInt(process.env.RETRY_MAX_ATTEMPTS || '3', 10),
  BASE_DELAY_MS: parseInt(process.env.RETRY_BASE_DELAY_MS || '1000', 10),
  MAX_DELAY_MS: parseInt(process.env.RETRY_MAX_DELAY_MS || '30000', 10),
  JITTER_ENABLED: process.env.RETRY_JITTER_ENABLED !== 'false',
} as const;

/**
 * Conversation/Dialogue configuration
 */
export const DIALOGUE_CONFIG = {
  MAX_TURNS: (() => {
    const envMaxTurns = process.env.MAX_TURNS;
    if (!envMaxTurns) {
      return 20; // Default value
    }
    const parsed = parseInt(envMaxTurns, 10);
    if (isNaN(parsed) || parsed < 1) {
      return 20; // Invalid value, use default
    }
    return parsed;
  })(),
  MIN_MESSAGE_LENGTH: 10,
  MAX_MESSAGE_LENGTH: 1000,
  RESOLUTION_CONVERGENCE_THRESHOLD: 300, // Characters
  RESOLUTION_CONFIDENCE_THRESHOLD: 10, // Minimum confidence score for resolution (increased from 5 for stricter detection)
  RESOLUTION_MIN_ROUNDS: 5, // Minimum rounds before checking for resolution (15 messages minimum)
  RESOLUTION_CONSENSUS_ROUNDS: 2, // Require consensus across 2+ consecutive rounds
  MIN_MESSAGES_FOR_RESOLUTION: 4,
  AUTO_RESOLVE_TURN_LIMIT: 20,
  RESOLUTION_SOLUTION_MAX_LENGTH: 500, // Maximum length for extracted solution text
  RESOLUTION_CONFIDENCE_THRESHOLD_HIGH: 0.85, // High confidence threshold for display (increased from 0.7)
  RESOLUTION_TOPIC_RELEVANCE_THRESHOLD: 0.3, // Minimum topic relevance score
} as const;

/**
 * File upload configuration
 */
export const FILE_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB in bytes
  MAX_BASE64_SIZE: 15 * 1024 * 1024, // 15MB (accounting for base64 encoding overhead)
  MAX_FILES: 5,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  ALLOWED_PDF_TYPE: 'application/pdf',
} as const;

/**
 * LLM provider configuration
 *
 * MAX_TOKENS Configuration:
 * - Default: 1000 tokens per response
 * - Recommended range: 1000-2000 tokens for comprehensive responses
 * - Minimum: 500 tokens (may cause truncation)
 * - Maximum: Provider-dependent (typically 4096-8192 for most models)
 * - Configuration: Set MAX_TOKENS environment variable to override default
 *
 * Provider-specific limits (approximate):
 * - Groq: 8192 tokens (model-dependent)
 * - Mistral: 8192 tokens (model-dependent)
 * - OpenRouter: Varies by model (typically 4096-8192)
 *
 * Note: Lower values may cause truncation, requiring completion logic to finish responses.
 * Higher values allow more comprehensive responses but increase token usage and cost.
 */
export const LLM_CONFIG = {
  DEFAULT_TIMEOUT_MS: 60000, // 60 seconds
  DEFAULT_MAX_TOKENS: (() => {
    const envMaxTokens = process.env.MAX_TOKENS;
    if (!envMaxTokens) {
      return 2000; // Default max tokens per response (configurable via MAX_TOKENS env var). Increased from 1000 to 2000 for more comprehensive responses (300-500 words as per prompts).
    }
    const parsed = parseInt(envMaxTokens, 10);
    if (isNaN(parsed) || parsed < 1) {
      logger.warn('Invalid MAX_TOKENS value, using default', {
        providedValue: envMaxTokens,
        defaultValue: 2000,
      });
      return 2000; // Invalid value, use default
    }
    // Validate reasonable range (500-8192)
    if (parsed < 500) {
      logger.warn('MAX_TOKENS is very low, may cause frequent truncation', {
        providedValue: parsed,
        recommendedMinimum: 1500,
      });
    } else if (parsed > 8192) {
      logger.warn('MAX_TOKENS exceeds typical provider limits, may cause errors', {
        providedValue: parsed,
        recommendedMaximum: 8192,
      });
    }
    return parsed;
  })(),
  SUMMARY_MAX_TOKENS: 200, // Reduced by 50% for summaries
  DEFAULT_TEMPERATURE: 0.7,
} as const;

/**
 * Database configuration
 */
export const DATABASE_CONFIG = {
  PATH: process.env.DATABASE_PATH || 'data/conversations.db',
  STATEMENT_CACHE_SIZE: 100,
} as const;

/**
 * Logging configuration
 */
export const LOGGING_CONFIG = {
  LEVEL: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
} as const;

/**
 * Validate port number
 * @param port - Port number to validate
 * @returns Validated port number
 * @throws Error if port is invalid
 */
function validatePort(port: number): number {
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port number: ${port}. Must be between 1 and 65535.`
    );
  }
  return port;
}

/**
 * Server configuration
 */
export const SERVER_CONFIG = {
  HOSTNAME: process.env.HOSTNAME || 'localhost',
  PORT: validatePort(parseInt(process.env.PORT || '3000', 10)),
  NODE_ENV: process.env.NODE_ENV || 'development',
} as const;

/**
 * Backup configuration
 */
export const BACKUP_CONFIG = {
  ENABLED: process.env.BACKUP_ENABLED === 'true' || process.env.BACKUP_ENABLED !== 'false',
  RETENTION_DAYS: parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10),
  INTERVAL_HOURS: parseInt(process.env.BACKUP_INTERVAL_HOURS || '1', 10),
} as const;

/**
 * Session configuration
 */
export const SESSION_CONFIG = {
  TIMEOUT_MINUTES: parseInt(process.env.SESSION_TIMEOUT_MINUTES || '1440', 10),
} as const;

/**
 * LLM timeout configuration (per provider)
 */
export const LLM_TIMEOUT_CONFIG = {
  GROQ: parseInt(process.env.LLM_TIMEOUT_GROQ || '60000', 10),
  MISTRAL: parseInt(process.env.LLM_TIMEOUT_MISTRAL || '90000', 10),
  OPENROUTER: parseInt(process.env.LLM_TIMEOUT_OPENROUTER || '120000', 10),
} as const;

/**
 * Security configuration
 */
export const SECURITY_CONFIG = {
  ENABLE_VIRUS_SCAN: process.env.ENABLE_VIRUS_SCAN === 'true',
  CLAMAV_HOST: process.env.CLAMAV_HOST || 'localhost',
  CLAMAV_PORT: parseInt(process.env.CLAMAV_PORT || '3310', 10),
} as const;

/**
 * File storage configuration
 */
export const FILE_STORAGE_CONFIG = {
  DISCUSSIONS_DIR: process.env.DISCUSSIONS_DIR || 'data/discussions',
  FILE_OPERATION_MAX_RETRIES: parseInt(process.env.FILE_OPERATION_MAX_RETRIES || '3', 10),
  FILE_OPERATION_RETRY_DELAY_MS: parseInt(process.env.FILE_OPERATION_RETRY_DELAY_MS || '100', 10),
} as const;

/**
 * Application URL configuration
 */
export const APP_CONFIG = {
  APP_URL: process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
} as const;

/**
 * Redis configuration
 */
export const REDIS_CONFIG = {
  REDIS_URL: process.env.REDIS_URL || undefined,
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
} as const;
