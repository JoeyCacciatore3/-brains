/**
 * Socket.IO Connection Manager
 *
 * Manages connection limits and DoS protection for Socket.IO connections.
 */

import { Socket, Server } from 'socket.io';
import { getRedisClient } from '@/lib/db/redis';
import { logger } from '@/lib/logger';

interface ConnectionInfo {
  socketId: string;
  ip: string;
  connectedAt: number;
  lastActivity: number;
  messageCount: number;
  messageWindowStart: number;
}

// In-memory connection tracking (fallback when Redis unavailable)
const connectionStore = new Map<string, ConnectionInfo[]>();
const ipConnectionCount = new Map<string, number>();
const ipConnectionRate = new Map<string, { count: number; windowStart: number }>();

// Configuration
const MAX_CONNECTIONS_PER_IP = parseInt(process.env.MAX_CONNECTIONS_PER_IP || '10', 10);
const CONNECTION_RATE_LIMIT = parseInt(process.env.CONNECTION_RATE_LIMIT || '5', 10); // Max connections per minute
const CONNECTION_RATE_WINDOW_MS = 60 * 1000; // 1 minute
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_MESSAGES_PER_MINUTE = parseInt(process.env.MAX_MESSAGES_PER_MINUTE || '100', 10);
const MAX_PAYLOAD_SIZE = 1024 * 1024; // 1MB

/**
 * Extract client IP address from socket
 */
function extractClientIP(socket: Socket): string {
  const forwardedFor = socket.handshake.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = typeof forwardedFor === 'string' ? forwardedFor.split(',') : [forwardedFor[0]];
    const clientIp = ips[0]?.trim();
    if (clientIp) {
      return clientIp;
    }
  }

  const address = socket.handshake.address;
  if (address) {
    return address.replace(/^::ffff:/, '');
  }

  return 'unknown';
}

/**
 * Check connection rate limit using Redis
 */
async function checkConnectionRateLimitRedis(ip: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    return false; // Fall back to in-memory
  }

  try {
    const key = `socket:connection_rate:${ip}`;
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.pexpire(key, CONNECTION_RATE_WINDOW_MS);
    }

    return count > CONNECTION_RATE_LIMIT;
  } catch (error) {
    logger.error('Redis connection rate limit check failed', {
      error: error instanceof Error ? error.message : String(error),
      ip,
    });
    return false; // Fall back to in-memory
  }
}

/**
 * Check connection rate limit using in-memory store
 */
function checkConnectionRateLimitMemory(ip: string): boolean {
  const now = Date.now();
  const entry = ipConnectionRate.get(ip);

  if (!entry || now - entry.windowStart >= CONNECTION_RATE_WINDOW_MS) {
    ipConnectionRate.set(ip, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count > CONNECTION_RATE_LIMIT;
}

/**
 * Check if IP has exceeded connection rate limit
 */
export async function checkConnectionRateLimit(ip: string): Promise<boolean> {
  const redis = getRedisClient();
  if (redis) {
    try {
      return await checkConnectionRateLimitRedis(ip);
    } catch {
      // Fall back to in-memory
    }
  }

  return checkConnectionRateLimitMemory(ip);
}

/**
 * Check connection count limit using Redis
 */
async function checkConnectionCountLimitRedis(ip: string): Promise<{ exceeded: boolean; count: number }> {
  const redis = getRedisClient();
  if (!redis) {
    return { exceeded: false, count: 0 }; // Fall back to in-memory
  }

  try {
    const key = `socket:connections:${ip}`;
    const count = await redis.scard(key);
    return { exceeded: count >= MAX_CONNECTIONS_PER_IP, count };
  } catch (error) {
    logger.error('Redis connection count check failed', {
      error: error instanceof Error ? error.message : String(error),
      ip,
    });
    return { exceeded: false, count: 0 }; // Fall back to in-memory
  }
}

/**
 * Check connection count limit using in-memory store
 */
function checkConnectionCountLimitMemory(ip: string): { exceeded: boolean; count: number } {
  const count = ipConnectionCount.get(ip) || 0;
  return { exceeded: count >= MAX_CONNECTIONS_PER_IP, count };
}

/**
 * Check if IP has exceeded connection count limit
 */
export async function checkConnectionCountLimit(ip: string): Promise<{ exceeded: boolean; count: number }> {
  const redis = getRedisClient();
  if (redis) {
    try {
      return await checkConnectionCountLimitRedis(ip);
    } catch {
      // Fall back to in-memory
    }
  }

  return checkConnectionCountLimitMemory(ip);
}

/**
 * Register a new connection
 */
export async function registerConnection(socket: Socket): Promise<void> {
  const ip = extractClientIP(socket);
  const now = Date.now();

  const connectionInfo: ConnectionInfo = {
    socketId: socket.id,
    ip,
    connectedAt: now,
    lastActivity: now,
    messageCount: 0,
    messageWindowStart: now,
  };

  // Store in Redis if available
  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `socket:connections:${ip}`;
      await redis.sadd(key, socket.id);
      await redis.pexpire(key, IDLE_TIMEOUT_MS * 2); // Expire after 2x idle timeout
    } catch (error) {
      logger.error('Failed to register connection in Redis', {
        error: error instanceof Error ? error.message : String(error),
        socketId: socket.id,
        ip,
      });
    }
  }

  // Store in memory
  const connections = connectionStore.get(ip) || [];
  connections.push(connectionInfo);
  connectionStore.set(ip, connections);
  ipConnectionCount.set(ip, (ipConnectionCount.get(ip) || 0) + 1);
}

/**
 * Unregister a connection
 */
export async function unregisterConnection(socket: Socket): Promise<void> {
  const ip = extractClientIP(socket);

  // Remove from Redis if available
  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `socket:connections:${ip}`;
      await redis.srem(key, socket.id);
    } catch (error) {
      logger.error('Failed to unregister connection from Redis', {
        error: error instanceof Error ? error.message : String(error),
        socketId: socket.id,
        ip,
      });
    }
  }

  // Remove from memory
  const connections = connectionStore.get(ip) || [];
  const filtered = connections.filter((c) => c.socketId !== socket.id);
  if (filtered.length === 0) {
    connectionStore.delete(ip);
    ipConnectionCount.delete(ip);
  } else {
    connectionStore.set(ip, filtered);
    ipConnectionCount.set(ip, filtered.length);
  }
}

/**
 * Update connection activity
 */
export function updateConnectionActivity(socket: Socket): void {
  const ip = extractClientIP(socket);
  const connections = connectionStore.get(ip);
  if (connections) {
    const connection = connections.find((c) => c.socketId === socket.id);
    if (connection) {
      connection.lastActivity = Date.now();
    }
  }
}

/**
 * Check message rate limit
 */
export function checkMessageRateLimit(socket: Socket): boolean {
  const ip = extractClientIP(socket);
  const connections = connectionStore.get(ip);
  if (!connections) {
    return false;
  }

  const connection = connections.find((c) => c.socketId === socket.id);
  if (!connection) {
    return false;
  }

  const now = Date.now();
  const windowElapsed = now - connection.messageWindowStart;

  if (windowElapsed >= 60000) {
    // Reset window
    connection.messageCount = 1;
    connection.messageWindowStart = now;
    return false;
  }

  connection.messageCount += 1;
  return connection.messageCount > MAX_MESSAGES_PER_MINUTE;
}

/**
 * Check payload size
 */
export function checkPayloadSize(payload: unknown): boolean {
  try {
    const size = JSON.stringify(payload).length;
    return size > MAX_PAYLOAD_SIZE;
  } catch {
    return true; // If we can't serialize, reject
  }
}

/**
 * Clean up expired connection rate limit entries
 */
function cleanupExpiredConnectionRateLimits(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [ip, entry] of ipConnectionRate.entries()) {
    if (now - entry.windowStart >= CONNECTION_RATE_WINDOW_MS) {
      ipConnectionRate.delete(ip);
      cleaned += 1;
    }
  }

  if (cleaned > 0) {
    logger.debug('Cleaned up expired connection rate limit entries', { cleaned });
  }
}

/**
 * Clean up idle connections
 */
export function cleanupIdleConnections(io: Server): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [ip, connections] of connectionStore.entries()) {
    for (const connection of connections) {
      if (now - connection.lastActivity > IDLE_TIMEOUT_MS) {
        logger.info('Disconnecting idle connection', {
          socketId: connection.socketId,
          ip,
          idleTime: now - connection.lastActivity,
        });
        io.sockets.sockets.get(connection.socketId)?.disconnect(true);
        cleaned += 1;
      }
    }
  }

  if (cleaned > 0) {
    logger.info('Cleaned up idle connections', { cleaned });
  }
}

/**
 * Get connection statistics
 */
export function getConnectionStats(): {
  totalConnections: number;
  connectionsByIP: Record<string, number>;
  idleConnections: number;
} {
  const now = Date.now();
  let totalConnections = 0;
  let idleConnections = 0;
  const connectionsByIP: Record<string, number> = {};

  for (const [ip, connections] of connectionStore.entries()) {
    connectionsByIP[ip] = connections.length;
    totalConnections += connections.length;

    for (const connection of connections) {
      if (now - connection.lastActivity > IDLE_TIMEOUT_MS) {
        idleConnections += 1;
      }
    }
  }

  return {
    totalConnections,
    connectionsByIP,
    idleConnections,
  };
}

// Store interval ID for cleanup on shutdown
let connectionCleanupIntervalId: NodeJS.Timeout | null = null;

/**
 * Periodic connection cleanup
 * @returns The interval ID for cleanup purposes
 */
export function startPeriodicCleanup(io: Server): NodeJS.Timeout | null {
  if (typeof setInterval !== 'undefined') {
    connectionCleanupIntervalId = setInterval(() => {
      cleanupIdleConnections(io);
      cleanupExpiredConnectionRateLimits();
    }, 5 * 60 * 1000); // Every 5 minutes
    return connectionCleanupIntervalId;
  }
  return null;
}

/**
 * Stop periodic connection cleanup
 * Should be called during graceful shutdown
 */
export function stopPeriodicCleanup(): void {
  if (connectionCleanupIntervalId !== null) {
    clearInterval(connectionCleanupIntervalId);
    connectionCleanupIntervalId = null;
  }
}
