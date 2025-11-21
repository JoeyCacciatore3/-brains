/**
 * Client-side logger for browser environments
 * Provides structured logging that matches server-side logger interface
 * Falls back to console methods in browser
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

class ClientLogger {
  private level: LogLevel;

  constructor() {
    // Determine log level from environment or default to 'info'
    const envLevel = process.env.NEXT_PUBLIC_LOG_LEVEL as LogLevel | undefined;
    this.level = envLevel || (process.env.NODE_ENV === 'development' ? 'debug' : 'info');
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.level);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, context));
    }
  }
}

export const clientLogger = new ClientLogger();
export default clientLogger;
