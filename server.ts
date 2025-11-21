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
import { startTempFileCleanup } from './src/lib/discussions/temp-cleanup';

// Load environment variables from .env.local (Next.js convention)
config({ path: resolve(process.cwd(), '.env.local') });
// Also try .env as fallback
config({ path: resolve(process.cwd(), '.env') });

// Validate environment variables before starting server
validateEnvironmentOrExit();

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

// Start temp file cleanup job
startTempFileCleanup();

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

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
      } catch (handleError: any) {
        // Check if this is a webpack chunk/module error
        if (
          handleError?.message?.includes('Cannot find module') ||
          handleError?.message?.includes('Module not found') ||
          handleError?.code === 'MODULE_NOT_FOUND'
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
                  <p><strong>Error:</strong> ${handleError.message}</p>
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
        logger.error('Error occurred handling request', {
          url: req.url,
          error: handleError,
          message: handleError?.message,
          stack: handleError?.stack,
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
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl) {
      return [appUrl];
    }

    // Fallback
    return [`http://${hostname}:${port}`];
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

  // Setup Socket.IO handlers with connection management
  setupSocketHandlers(io);

  // Start periodic cleanup of idle connections
  import('./src/lib/socket/connection-manager').then(({ cleanupIdleConnections }) => {
    setInterval(() => {
      cleanupIdleConnections(io);
    }, 60000); // Check every minute
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
        env: process.env.NODE_ENV,
      });

      // Automatically open browser in development mode
      if (dev) {
        const url = `http://${hostname}:${port}`;
        import('open').then((openModule) => {
          const open = openModule.default;
          return open(url);
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
