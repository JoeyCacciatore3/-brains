import winston from 'winston';

const isDevelopment = process.env.NODE_ENV !== 'production';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development (more readable)
const consoleFormat = winston.format.combine(
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
