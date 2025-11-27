import Database from 'better-sqlite3';
import { createDatabase } from './schema';
import { logger } from '@/lib/logger';
import path from 'path';
import fs from 'fs';

let dbInstance: Database.Database | null = null;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Get database path from environment or default
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'conversations.db');
const dbDir = path.dirname(dbPath);

/**
 * Ensure database directory exists with proper permissions
 */
function ensureDatabaseDirectory(): void {
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true, mode: 0o755 });
      logger.info('Database directory created', { path: dbDir });
    }

    // Check write permissions
    try {
      fs.accessSync(dbDir, fs.constants.W_OK);
    } catch (permError) {
      const errorMessage = permError instanceof Error ? permError.message : String(permError);
      throw new Error(
        `Database directory is not writable: ${dbDir}. ` +
          `Please check permissions or set DATABASE_PATH to a writable location. ` +
          `Error: ${errorMessage}`
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to ensure database directory exists', {
      error: errorMessage,
      path: dbDir,
    });
    throw new Error(`Database directory setup failed: ${errorMessage}`);
  }
}

/**
 * Handle WAL file locks by checking for stale locks
 */
function handleWALFileLocks(): void {
  try {
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;

    // Check if WAL files exist and are stale (older than 5 minutes)
    if (fs.existsSync(walPath)) {
      const walStats = fs.statSync(walPath);
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

      if (walStats.mtimeMs < fiveMinutesAgo) {
        logger.warn('Stale WAL file detected, attempting cleanup', { walPath });
        try {
          // Close any existing connection first
          if (dbInstance) {
            try {
              dbInstance.close();
            } catch {
              // Ignore errors when closing
            }
            dbInstance = null;
          }

          // Remove stale WAL files
          if (fs.existsSync(walPath)) {
            fs.unlinkSync(walPath);
            logger.info('Removed stale WAL file', { walPath });
          }
          if (fs.existsSync(shmPath)) {
            fs.unlinkSync(shmPath);
            logger.info('Removed stale SHM file', { shmPath });
          }
        } catch (cleanupError) {
          logger.warn('Failed to cleanup stale WAL files, continuing anyway', {
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
      }
    }
  } catch (error) {
    // Non-critical, just log and continue
    logger.debug('WAL file lock check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Sleep utility for async retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt to recover from database issues
 * @returns boolean - true if recovery was successful, false otherwise
 */
export function attemptDatabaseRecovery(): boolean {
  try {
    logger.info('Attempting database recovery', { path: dbPath });

    // Close existing connection if any
    if (dbInstance) {
      try {
        dbInstance.close();
      } catch {
        // Ignore errors when closing
      }
      dbInstance = null;
    }

    // Handle WAL file locks
    handleWALFileLocks();

    // Try to reinitialize
    try {
      dbInstance = createDatabaseWithRetry();
      logger.info('Database recovery successful', { path: dbPath });
      return true;
    } catch (error) {
      logger.error('Database recovery failed', {
        error: error instanceof Error ? error.message : String(error),
        path: dbPath,
      });
      return false;
    }
  } catch (error) {
    logger.error('Error during database recovery attempt', {
      error: error instanceof Error ? error.message : String(error),
      path: dbPath,
    });
    return false;
  }
}

/**
 * Check if database file exists and is accessible
 * @returns Object with file status information
 */
export function checkDatabaseFileStatus(): {
  exists: boolean;
  readable: boolean;
  writable: boolean;
  error?: string;
} {
  try {
    const exists = fs.existsSync(dbPath);
    if (!exists) {
      return { exists: false, readable: false, writable: false };
    }

    let readable = false;
    let writable = false;

    try {
      fs.accessSync(dbPath, fs.constants.R_OK);
      readable = true;
    } catch {
      readable = false;
    }

    try {
      fs.accessSync(dbPath, fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }

    return { exists, readable, writable };
  } catch (error) {
    return {
      exists: false,
      readable: false,
      writable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check database connection health
 * Attempts to initialize database if not already initialized
 * @returns boolean - true if database is healthy, false otherwise
 */
export function checkDatabaseHealth(): boolean {
  // Check file status first
  const fileStatus = checkDatabaseFileStatus();
  if (!fileStatus.exists || !fileStatus.writable) {
    logger.warn('Database file status check failed', {
      fileStatus,
      path: dbPath,
    });
    // Try recovery
    return attemptDatabaseRecovery();
  }

  // Try to initialize if not already initialized
  if (!dbInstance) {
    try {
      initializeDatabase();
    } catch (error) {
      logger.error('Database initialization failed during health check', { error });
      // Try recovery
      return attemptDatabaseRecovery();
    }
  }

  if (!dbInstance) {
    return false;
  }

  try {
    // Run a simple query to verify connection
    dbInstance.prepare('SELECT 1').get();
    return true;
  } catch (error) {
    logger.error('Database health check failed', { error });
    // Try recovery
    return attemptDatabaseRecovery();
  }
}

/**
 * Create database connection with async retry logic
 * @returns Promise<Database.Database>
 */
async function createDatabaseWithRetryAsync(): Promise<Database.Database> {
  let lastError: Error | null = null;

  // Ensure directory exists before attempting connection
  ensureDatabaseDirectory();

  // Handle WAL file locks
  handleWALFileLocks();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const db = createDatabase();
      logger.info('Database connection established', { attempt, path: dbPath });
      return db;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorCode = (error as { code?: string })?.code || 'UNKNOWN';
      const errorMessage = lastError.message;

      logger.warn(`Database connection attempt ${attempt} failed`, {
        error: errorMessage,
        errorCode,
        attempt,
        path: dbPath,
      });

      if (attempt < MAX_RETRIES) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.info(`Retrying database connection in ${delay}ms...`, {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
        });

        // Handle WAL locks before retry
        if (errorCode === 'SQLITE_BUSY' || errorCode === 'SQLITE_LOCKED') {
          handleWALFileLocks();
        }

        await sleep(delay);
      }
    }
  }

  // Provide detailed error message
  const errorDetails = lastError
    ? {
        message: lastError.message,
        code: (lastError as { code?: string })?.code || 'UNKNOWN',
        path: dbPath,
        directory: dbDir,
      }
    : { path: dbPath, directory: dbDir };

  logger.error('Failed to create database connection after all retries', {
    ...errorDetails,
    maxRetries: MAX_RETRIES,
  });

  const userFriendlyMessage =
    lastError && (lastError as { code?: string })?.code === 'SQLITE_BUSY'
      ? `Database is locked. Another process may be using it. Path: ${dbPath}`
      : lastError && (lastError as { code?: string })?.code === 'SQLITE_CANTOPEN'
        ? `Cannot open database. Check permissions for: ${dbDir}`
        : `Failed to connect to database after ${MAX_RETRIES} attempts. Path: ${dbPath}. Error: ${lastError?.message || 'Unknown error'}`;

  throw new Error(userFriendlyMessage);
}

/**
 * Synchronous version for backward compatibility (used in getDatabase)
 * This will attempt immediate connection, but initialization should use async version
 *
 * IMPORTANT: This function cannot wait between retries because it's synchronous.
 * For proper retry logic with delays, use initializeDatabaseAsync() during server startup.
 * This function is only used as a fallback when getDatabase() is called before async initialization completes.
 */
function createDatabaseWithRetry(): Database.Database {
  // Ensure directory exists
  ensureDatabaseDirectory();

  // Handle WAL file locks
  handleWALFileLocks();

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const db = createDatabase();
      logger.info('Database connection established', { attempt, path: dbPath });
      return db;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorCode = (error as { code?: string })?.code || 'UNKNOWN';

      logger.warn(`Database connection attempt ${attempt} failed`, {
        error: lastError.message,
        errorCode,
        attempt,
        path: dbPath,
        note: 'Synchronous retry - no delay between attempts. Use initializeDatabaseAsync() for proper retry logic.',
      });

      if (attempt < MAX_RETRIES) {
        // Handle WAL locks before retry
        if (errorCode === 'SQLITE_BUSY' || errorCode === 'SQLITE_LOCKED') {
          handleWALFileLocks();
        }
        // Note: Synchronous version can't actually wait between retries
        // We use process.nextTick to yield to event loop, but this doesn't add meaningful delay
        // The async version (initializeDatabaseAsync) should be used for initialization with proper delays
        if (attempt > 1) {
          // Yield to event loop to allow other operations, but don't block
          process.nextTick(() => {
            // This is just to yield, no actual delay
          });
        }
      }
    }
  }

  const userFriendlyMessage =
    lastError && (lastError as { code?: string })?.code === 'SQLITE_BUSY'
      ? `Database is locked. Another process may be using it. Path: ${dbPath}`
      : lastError && (lastError as { code?: string })?.code === 'SQLITE_CANTOPEN'
        ? `Cannot open database. Check permissions for: ${dbDir}`
        : `Failed to connect to database. Path: ${dbPath}. Error: ${lastError?.message || 'Unknown error'}`;

  throw new Error(userFriendlyMessage);
}

/**
 * Initialize database connection on server startup (async version)
 * This ensures the database is ready before health checks and requests
 * @throws Error if database initialization fails
 */
export async function initializeDatabaseAsync(): Promise<void> {
  if (!dbInstance) {
    try {
      dbInstance = await createDatabaseWithRetryAsync();
      logger.info('Database initialized successfully', { path: dbPath });
    } catch (error) {
      logger.error('Failed to initialize database', {
        error: error instanceof Error ? error.message : String(error),
        path: dbPath,
        directory: dbDir,
      });
      throw error;
    }
  }
}

/**
 * Initialize database connection on server startup (synchronous version for backward compatibility)
 * This ensures the database is ready before health checks and requests
 * @throws Error if database initialization fails
 */
export function initializeDatabase(): void {
  if (!dbInstance) {
    try {
      dbInstance = createDatabaseWithRetry();
      logger.info('Database initialized successfully', { path: dbPath });
    } catch (error) {
      logger.error('Failed to initialize database', {
        error: error instanceof Error ? error.message : String(error),
        path: dbPath,
        directory: dbDir,
      });
      throw error;
    }
  }
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    dbInstance = createDatabaseWithRetry();
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error closing database connection', { error });
    } finally {
      dbInstance = null;
    }
  }
}

// Export transaction wrapper
export { withTransaction } from './transaction';
