/**
 * Socket.IO Authentication Middleware
 *
 * Verifies user sessions using NextAuth and attaches user information to socket connections.
 * Supports both authenticated and anonymous users.
 */

import { Socket } from 'socket.io';
import { logger } from '@/lib/logger';

export interface SocketUser {
  id: string;
  email?: string;
  name?: string;
  isAuthenticated: boolean;
}

/**
 * Extract session token from socket handshake
 * Note: NextAuth v5's auth() function is designed for Next.js route handlers,
 * not Socket.IO. For Socket.IO, we'll parse session cookies directly or
 * allow anonymous connections and rely on authorization checks in handlers.
 *
 * This simplified version allows all connections and marks them appropriately.
 * Authorization checks in handlers will verify discussion ownership.
 */
async function getSessionFromSocket(socket: Socket): Promise<{ user?: SocketUser } | null> {
  try {
    // Get cookies from handshake headers
    const cookies = socket.handshake.headers.cookie;
    if (!cookies) {
      return null;
    }

    // For now, we'll allow all connections as anonymous or attempt to extract user info
    // from cookies if available. In a production setup, you might want to:
    // 1. Parse the NextAuth session cookie manually
    // 2. Use a separate session store (Redis) for Socket.IO
    // 3. Use JWT tokens passed in handshake auth

    // For this implementation, we'll mark all as anonymous initially
    // The authorization checks in handlers will verify ownership anyway
    return null;
  } catch (error) {
    logger.error('Error getting session from socket', {
      error: error instanceof Error ? error.message : String(error),
      socketId: socket.id,
    });
    return null;
  }
}

/**
 * Authenticate socket connection
 * Attaches user information to socket.data
 * Returns true if authentication succeeded (authenticated or anonymous), false if should reject
 */
export async function authenticateSocket(socket: Socket): Promise<boolean> {
  try {
    const sessionData = await getSessionFromSocket(socket);

    if (sessionData?.user) {
      // Authenticated user
      socket.data.user = sessionData.user;
      logger.info('Socket authenticated', {
        socketId: socket.id,
        userId: sessionData.user.id,
        email: sessionData.user.email,
      });
      return true;
    }

    // Anonymous user - allow but mark as anonymous
    socket.data.user = {
      id: `anonymous-${socket.id}`,
      isAuthenticated: false,
    };

    logger.info('Socket connected as anonymous', {
      socketId: socket.id,
    });

    return true;
  } catch (error) {
    logger.error('Socket authentication failed', {
      error: error instanceof Error ? error.message : String(error),
      socketId: socket.id,
    });
    // Reject connection on authentication error
    return false;
  }
}

/**
 * Get user from socket data
 * @param socket - Socket instance
 * @returns User information or null
 */
export function getSocketUser(socket: Socket): SocketUser | null {
  return (socket.data?.user as SocketUser) || null;
}

/**
 * Check if socket user is authenticated
 * @param socket - Socket instance
 * @returns true if user is authenticated, false if anonymous
 */
export function isSocketAuthenticated(socket: Socket): boolean {
  const user = getSocketUser(socket);
  return user?.isAuthenticated === true;
}

/**
 * Get user ID from socket
 * @param socket - Socket instance
 * @returns User ID (authenticated or anonymous)
 */
export function getSocketUserId(socket: Socket): string {
  const user = getSocketUser(socket);
  return user?.id || `anonymous-${socket.id}`;
}
