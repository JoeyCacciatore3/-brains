import { config } from 'dotenv';
import { resolve } from 'path';
import { createServer } from 'http';
import { parse } from 'url';
import { existsSync } from 'fs';
import next from 'next';
import { Server } from 'socket.io';
import { setupSocketHandlers } from './src/lib/socket/handlers';
import { validateEnvironmentOrExit } from './src/lib/env-validation';
import { logger } from './src/lib/logger';
import { closeDatabase } from './src/lib/db';
import { closeRedisClient } from './src/lib/db/redis';
import { startTempFileCleanup, cleanupOrphanedTempFiles } from './src/lib/discussions/temp-cleanup';
import { cleanupRateLimitIntervals, clearRateLimitStores } from './src/lib/rate-limit';
import { stopPeriodicCleanup } from './src/lib/socket/connection-manager';
import { SERVER_CONFIG, APP_CONFIG, REDIS_CONFIG } from './src/lib/config';

// Load environment variables from .env.local (Next.js convention)
config({ path: resolve(process.cwd(), '.env.local') });
// Also try .env as fallback
config({ path: resolve(process.cwd(), '.env') });

// Validate environment variables before starting server
validateEnvironmentOrExit();

// Validate configuration and log results
import('./src/lib/config/validator').then(({ validateAndLogConfiguration }) => {
  validateAndLogConfiguration();
}).catch((error) => {
  logger.warn('Configuration validation failed', { error });
});

// Initialize database on server startup (async, non-blocking)
// Use async version but don't block server startup
(async () => {
  try {
    const { initializeDatabaseAsync } = await import('./src/lib/db');
    await initializeDatabaseAsync();
    logger.info('Database initialized on server startup');
  } catch (error) {
    logger.error('Failed to initialize database on startup', { error });
    logger.error('Server will continue but database operations may fail');
  }
})();

// Clear rate limit stores on server start (fresh start)
clearRateLimitStores();

// Start temp file cleanup job
startTempFileCleanup();

// Run startup cleanup for orphaned temp files
cleanupOrphanedTempFiles()
  .then((result) => {
    logger.info('Startup cleanup completed', {
      cleaned: result.cleaned,
      errors: result.errors,
      totalSizeMB: (result.totalSize / 1024 / 1024).toFixed(2),
    });
  })
  .catch((error) => {
    logger.error('Startup cleanup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't block server startup on cleanup failure
  });

// Start periodic backup scheduler
import('./src/lib/discussions/backup-manager').then(({ schedulePeriodicBackups }) => {
  schedulePeriodicBackups().catch((error) => {
    logger.error('Failed to start backup scheduler', { error });
  });
});

// Start memory monitoring
import('./src/lib/memory-manager').then(({ setupMemoryMonitoring }) => {
  setupMemoryMonitoring();
}).catch((error) => {
  logger.error('Failed to start memory monitoring', { error });
});

const dev = SERVER_CONFIG.NODE_ENV !== 'production';
const hostname = SERVER_CONFIG.HOSTNAME;
const port = SERVER_CONFIG.PORT;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Validate build directory exists (for production)
if (!dev) {
  const nextDir = resolve(process.cwd(), '.next');
  if (!existsSync(nextDir)) {
    logger.error('Build directory (.next) not found. Please run "npm run build" first.');
    process.exit(1);
  }

  // Validate critical build files exist
  const buildManifest = resolve(nextDir, 'build-manifest.json');
  if (!existsSync(buildManifest)) {
    logger.error('Build appears incomplete. Missing build-manifest.json. Please run "npm run build" again.');
    process.exit(1);
  }

  logger.info('Build directory validated');
}

// Validate production configuration before starting server
if (!dev) {
  const appUrl = APP_CONFIG.APP_URL;
  if (!appUrl || appUrl === 'http://localhost:3000') {
    logger.error('APP_URL environment variable is required in production', {
      nodeEnv: SERVER_CONFIG.NODE_ENV,
      recommendation: 'Set APP_URL to your production domain (e.g., https://yourdomain.com)',
    });
    process.exit(1);
  }
}

app.prepare().catch((error) => {
  logger.error('Failed to prepare Next.js app', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  if (dev) {
    logger.error('Build preparation failed. Try: npm run clean && npm run dev');
  } else {
    logger.error('Build preparation failed. Ensure you ran "npm run build" successfully.');
  }

  process.exit(1);
}).then(() => {
  logger.info('Next.js app prepared successfully');

  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url || '/', true);

      // Enhanced error handling for webpack chunk errors
      try {
        await handle(req, res, parsedUrl);
      } catch (handleError: unknown) {
        // Type guard for error objects
        const isError = (error: unknown): error is Error & { code?: string } => {
          return (
            typeof error === 'object' &&
            error !== null &&
            'message' in error &&
            typeof (error as { message: unknown }).message === 'string'
          );
        };

        // Check if this is a webpack chunk/module error
        if (
          isError(handleError) &&
          (handleError.message.includes('Cannot find module') ||
            handleError.message.includes('Module not found') ||
            handleError.code === 'MODULE_NOT_FOUND')
        ) {
          logger.error('Webpack chunk/module error detected', {
            url: req.url,
            error: handleError.message,
            stack: handleError.stack,
          });

          // In development, suggest cleaning build
          if (dev) {
            logger.error(
              'This appears to be a corrupted build. Try running: rm -rf .next && npm run dev'
            );
          }

          // Return a helpful error page
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'text/html');
            res.end(`
              <!DOCTYPE html>
              <html>
                <head><title>Build Error</title></head>
                <body style="font-family: system-ui; padding: 2rem; max-width: 800px; margin: 0 auto;">
                  <h1>Build Error Detected</h1>
                  <p>The application build appears to be corrupted or incomplete.</p>
                  <p><strong>Error:</strong> ${isError(handleError) ? handleError.message : String(handleError)}</p>
                  <h2>How to Fix:</h2>
                  <ol>
                    <li>Stop the development server (Ctrl+C)</li>
                    <li>Run: <code>npm run clean</code> or <code>rm -rf .next</code></li>
                    <li>Restart: <code>npm run dev</code></li>
                  </ol>
                  <p>If the problem persists, try: <code>npm run build</code> first, then <code>npm run dev</code></p>
                </body>
              </html>
            `);
          }
          return;
        }

        // For other errors, log and return generic error
        const errorMessage = isError(handleError) ? handleError.message : String(handleError);
        const errorStack = isError(handleError) ? handleError.stack : undefined;
        logger.error('Error occurred handling request', {
          url: req.url,
          error: handleError,
          message: errorMessage,
          stack: errorStack,
        });

        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('internal server error');
        }
      }
    } catch (err) {
      logger.error('Unexpected error in request handler', { url: req.url, error: err });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('internal server error');
      }
    }
  });

  // CORS configuration with origin validation
  const getAllowedOrigins = (): string[] => {
    if (dev) {
      return [`http://${hostname}:${port}`, 'http://localhost:3000'];
    }

    // Production: use server-side env variable (not NEXT_PUBLIC_*)
    // CRITICAL: Fail fast in production if APP_URL is not set
    const appUrl = APP_CONFIG.APP_URL;
    if (!appUrl || appUrl === 'http://localhost:3000') {
      const errorMessage = 'APP_URL environment variable is required in production. Please set APP_URL to your production domain (e.g., https://yourdomain.com)';
      logger.error(errorMessage, {
        hostname,
        port,
        nodeEnv: SERVER_CONFIG.NODE_ENV,
      });
      throw new Error(errorMessage);
    }

    return [appUrl];
  };

  const allowedOrigins = getAllowedOrigins();

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) {
          return callback(null, true);
        }

        // Check if origin is in allowed list
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        // Reject origin
        logger.warn('CORS: Rejected origin', { origin, allowedOrigins });
        return callback(new Error('Not allowed by CORS'));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Configure Socket.IO Redis adapter for horizontal scaling
  (async () => {
    try {
      const { getRedisClient } = await import('./src/lib/db/redis');
      const redis = getRedisClient();

      if (redis) {
        // Check if Redis URL is available for adapter configuration
        const redisUrl = REDIS_CONFIG.REDIS_URL;
        const redisHost = REDIS_CONFIG.REDIS_HOST;
        const redisPort = REDIS_CONFIG.REDIS_PORT;
        const redisPassword = REDIS_CONFIG.REDIS_PASSWORD;

        if (redisUrl || redisHost) {
          try {
            const { createAdapter } = await import('@socket.io/redis-adapter');
            const { createClient } = await import('redis');

            // Create pub/sub clients for the adapter
            const pubClient = createClient({
              url: redisUrl || `redis://${redisHost}:${redisPort}`,
              password: redisPassword || undefined,
            });

            const subClient = pubClient.duplicate();

            // Connect both clients
            await Promise.all([pubClient.connect(), subClient.connect()]);

            // Set up error handlers
            pubClient.on('error', (err: Error) => {
              logger.error('Socket.IO Redis pub client error', { error: err });
            });

            subClient.on('error', (err: Error) => {
              logger.error('Socket.IO Redis sub client error', { error: err });
            });

            // Configure the adapter
            io.adapter(createAdapter(pubClient, subClient));
            logger.info('Socket.IO Redis adapter configured successfully');
          } catch (error) {
            logger.warn('Failed to configure Socket.IO Redis adapter, continuing without it', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to setup Socket.IO Redis adapter, continuing without it', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  // Setup Socket.IO handlers with connection management
  setupSocketHandlers(io);

  // Start periodic cleanup of idle connections
  import('./src/lib/socket/connection-manager').then(({ startPeriodicCleanup }) => {
    startPeriodicCleanup(io);
  });

  // Graceful shutdown handlers
  const gracefulShutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`);

    // Stop accepting new connections
    httpServer.close(() => {
      logger.info('HTTP server closed');

      // Close Socket.IO server
      io.close(() => {
        logger.info('Socket.IO server closed');

        // Stop connection cleanup interval
        stopPeriodicCleanup();
        logger.info('Connection cleanup stopped');

        // Stop rate limit cleanup intervals
        cleanupRateLimitIntervals();
        logger.info('Rate limit cleanup stopped');

        // Close database connections
        closeDatabase();
        logger.info('Database connection closed');

        // Close Redis connection
        closeRedisClient();
        logger.info('Redis connection closed');

        logger.info('Graceful shutdown complete');
        process.exit(0);
      });
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  // Register signal handlers
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  httpServer
    .once('error', (err) => {
      logger.error('HTTP server error', { error: err });
      process.exit(1);
    })
    .listen(port, () => {
      logger.info(`Server ready on http://${hostname}:${port}`, {
        hostname,
        port,
        env: SERVER_CONFIG.NODE_ENV,
      });

      // Automatically open browser in development mode
      if (dev) {
        const url = `http://${hostname}:${port}`;
        import('open').then((openModule) => {
          const open = openModule.default;
          // Try to open Chrome specifically
          // On Linux, try 'google-chrome' first, then 'chromium-browser' as fallback
          return open(url, {
            app: {
              name: 'google-chrome',
              arguments: ['--new-window'],
            },
          }).catch(() => {
            // Fallback to chromium-browser if google-chrome is not available
            return open(url, {
              app: {
                name: 'chromium-browser',
                arguments: ['--new-window'],
              },
            });
          }).catch(() => {
            // Final fallback to default browser
            return open(url);
          });
        }).catch((err) => {
          // Log error but don't fail server startup if browser can't be opened
          logger.warn('Failed to open browser automatically', {
            url,
            error: err instanceof Error ? err.message : String(err),
          });
          logger.info(`Please open your browser and navigate to ${url}`);
        });
      }
    });
});
