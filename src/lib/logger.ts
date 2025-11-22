import winston from 'winston';

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Patterns for sensitive data that should be sanitized from logs
 */
const SENSITIVE_PATTERNS = [
  // API keys (common patterns)
  /(api[_-]?key|apikey)\s*[:=]\s*["']?([a-zA-Z0-9_\-]{20,})["']?/gi,
  /(secret|token|password|pwd|passwd)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
  // Email addresses
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  // JWT tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // UUIDs that might be sensitive (we'll keep discussion IDs but sanitize others in certain contexts)
  // Credit card numbers (basic pattern)
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  // Social security numbers (US format)
  /\b\d{3}-\d{2}-\d{4}\b/g,
];

/**
 * Sanitize sensitive data from log entries
 * @param data - Data to sanitize (object, string, or any value)
 * @returns Sanitized data
 */
export function sanitizeLogData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  // Handle strings
  if (typeof data === 'string') {
    let sanitized = data;
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, () => {
        // Replace with redacted marker
        if (pattern.source.includes('email')) {
          return '[EMAIL_REDACTED]';
        }
        if (pattern.source.includes('api') || pattern.source.includes('secret') || pattern.source.includes('token')) {
          return '[SECRET_REDACTED]';
        }
        return '[REDACTED]';
      });
    }
    return sanitized;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item));
  }

  // Handle objects
  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = [
      'apiKey',
      'api_key',
      'apikey',
      'secret',
      'token',
      'password',
      'pwd',
      'passwd',
      'email',
      'jwt',
      'authorization',
      'auth',
      'creditCard',
      'credit_card',
      'ssn',
      'socialSecurity',
      'fileContent',
      'base64',
      'fileData',
    ];

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      // Skip sensitive keys entirely or sanitize their values
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (lowerKey === 'files' && Array.isArray(value)) {
        // For file arrays, only log metadata, not content
        sanitized[key] = value.map((file: unknown) => {
          if (typeof file === 'object' && file !== null) {
            const fileObj = file as Record<string, unknown>;
            return {
              name: fileObj.name,
              type: fileObj.type,
              size: fileObj.size,
              // Don't include base64 or content
            };
          }
          return file;
        });
      } else {
        // Recursively sanitize nested objects
        sanitized[key] = sanitizeLogData(value);
      }
    }
    return sanitized;
  }

  // Return primitive values as-is
  return data;
}

// Sanitize log data before formatting
const sanitizeFormat = winston.format((info) => {
  // Sanitize message if it's a string
  if (typeof info.message === 'string') {
    info.message = sanitizeLogData(info.message) as string;
  }

  // Sanitize all metadata
  const sanitizedMeta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(info)) {
    if (key !== 'level' && key !== 'timestamp' && key !== 'message' && key !== 'service') {
      sanitizedMeta[key] = sanitizeLogData(value);
    }
  }

  // Replace metadata with sanitized version
  Object.assign(info, sanitizedMeta);
  return info;
});

// Define log format with sanitization
const logFormat = winston.format.combine(
  sanitizeFormat(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development (more readable)
const consoleFormat = winston.format.combine(
  sanitizeFormat(),
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaString}`;
  })
);

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  format: logFormat,
  defaultMeta: { service: 'ai-dialogue-platform' },
  transports: [
    // Console transport (always enabled)
    new winston.transports.Console({
      format: isDevelopment ? consoleFormat : logFormat,
    }),
  ],
});

// Add file transport for production
if (!isDevelopment) {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );

  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Export convenience methods
export default logger;
