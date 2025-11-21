/**
 * Standardized error codes for the application
 */
export enum ErrorCode {
  // Rate limiting errors (1000-1099)
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // Validation errors (1100-1199)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_DISCUSSION_ID = 'INVALID_DISCUSSION_ID',
  INVALID_FILE_SIZE = 'INVALID_FILE_SIZE',
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',

  // Database errors (1200-1299)
  DATABASE_ERROR = 'DATABASE_ERROR',
  DISCUSSION_NOT_FOUND = 'DISCUSSION_NOT_FOUND',

  // LLM provider errors (1300-1399)
  LLM_PROVIDER_ERROR = 'LLM_PROVIDER_ERROR',
  LLM_TIMEOUT = 'LLM_TIMEOUT',
  NO_LLM_PROVIDER_AVAILABLE = 'NO_LLM_PROVIDER_AVAILABLE',
  MODEL_UNAVAILABLE = 'MODEL_UNAVAILABLE',

  // Network errors (1400-1499)
  NETWORK_ERROR = 'NETWORK_ERROR',
  SOCKET_ERROR = 'SOCKET_ERROR',

  // General errors (1500-1599)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Standardized error message format
 */
export interface AppError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Create a standardized error object
 */
export function createError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): AppError {
  return {
    code,
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Error message templates
 */
export const ErrorMessages = {
  RATE_LIMIT_EXCEEDED: 'Rate limit exceeded. Please try again later.',
  VALIDATION_ERROR: 'Validation failed',
  INVALID_DISCUSSION_ID: 'Invalid discussion ID format',
  INVALID_FILE_SIZE: 'File size exceeds the maximum allowed size',
  INVALID_FILE_TYPE: 'Invalid file type. Only images and PDFs are allowed.',
  DISCUSSION_NOT_FOUND: 'Discussion not found',
  LLM_PROVIDER_ERROR: 'LLM provider error',
  LLM_TIMEOUT: 'Request timeout: LLM API did not respond in time',
  NO_LLM_PROVIDER_AVAILABLE: 'No LLM providers available',
  MODEL_UNAVAILABLE: 'Model is unavailable or not found',
  NETWORK_ERROR: 'Network error occurred',
  SOCKET_ERROR: 'Socket connection error',
  INTERNAL_ERROR: 'An internal error occurred',
  UNKNOWN_ERROR: 'An unknown error occurred',
} as const;

/**
 * Helper function to create error from code
 */
export function createErrorFromCode(code: ErrorCode, details?: Record<string, unknown>): AppError {
  const message = (ErrorMessages as Record<string, string>)[code] || ErrorMessages.UNKNOWN_ERROR;
  return createError(code, message, details);
}
