/**
 * Centralized configuration constants
 * All environment variable defaults and application constants
 */

/**
 * Rate limiting configuration
 */
export const RATE_LIMIT_CONFIG = {
  MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10', 10),
  WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
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
  RESOLUTION_CONFIDENCE_THRESHOLD: 5, // Minimum confidence score for resolution
  MIN_MESSAGES_FOR_RESOLUTION: 4,
  AUTO_RESOLVE_TURN_LIMIT: 20,
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
 */
export const LLM_CONFIG = {
  DEFAULT_TIMEOUT_MS: 60000, // 60 seconds
  DEFAULT_MAX_TOKENS: 280, // Reduced by 30% for more concise responses
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
 * Server configuration
 */
export const SERVER_CONFIG = {
  HOSTNAME: process.env.HOSTNAME || 'localhost',
  PORT: parseInt(process.env.PORT || '3000', 10),
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
