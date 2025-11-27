/**
 * Socket.IO Authentication Middleware
 *
 * Verifies user sessions using NextAuth and attaches user information to socket connections.
 * Supports both authenticated and anonymous users.
 */

import { Socket } from 'socket.io';
import { jwtVerify } from 'jose';
import { logger } from '@/lib/logger';
import { getUserByEmail } from '@/lib/db/users';

export interface SocketUser {
  id: string;
  email?: string;
  name?: string;
  isAuthenticated: boolean;
}

/**
 * Parse cookies from cookie string
 */
function parseCookies(cookieString: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieString.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name && rest.length > 0) {
      cookies[name] = decodeURIComponent(rest.join('='));
    }
  });
  return cookies;
}

/**
 * Extract NextAuth session token from cookies
 */
function getSessionTokenFromCookies(cookies: Record<string, string>): string | null {
  // NextAuth v5 uses different cookie names in different environments
  // Try common cookie names
  const cookieNames = [
    '__Secure-next-auth.session-token', // Production with secure flag
    'next-auth.session-token', // Development and production without secure flag
    '__Host-next-auth.session-token', // Production with host-only flag
  ];

  for (const cookieName of cookieNames) {
    if (cookies[cookieName]) {
      return cookies[cookieName];
    }
  }

  return null;
}

/**
 * Extract session token from socket handshake and decode JWT
 * Verifies NextAuth session and returns user information
 */
async function getSessionFromSocket(socket: Socket): Promise<{ user?: SocketUser } | null> {
  try {
    // Get cookies from handshake headers
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) {
      return null;
    }

    // Parse cookies
    const cookies = parseCookies(cookieHeader);
    const sessionToken = getSessionTokenFromCookies(cookies);

    if (!sessionToken) {
      return null;
    }

    // Get NextAuth secret
    const secret = process.env.NEXTAUTH_SECRET;
    const isProduction = process.env.NODE_ENV === 'production';

    // Validate secret strength
    if (!secret) {
      if (isProduction) {
        logger.warn('NEXTAUTH_SECRET not configured in production', {
          socketId: socket.id,
        });
        return null;
      }
      // In development, allow anonymous connections
      return null;
    }

    // Validate secret meets minimum security requirements
    // Minimum length: 32 characters (recommended for production)
    // Should contain mixed alphanumeric and special characters
    const MIN_SECRET_LENGTH = 32;
    const hasMinLength = secret.length >= MIN_SECRET_LENGTH;
    const hasAlphanumeric = /[a-zA-Z0-9]/.test(secret);
    const hasSpecialChars = /[^a-zA-Z0-9]/.test(secret);
    const isWeakSecret = secret === 'development-secret-change-in-production' ||
                        secret.length < MIN_SECRET_LENGTH ||
                        (!hasAlphanumeric || !hasSpecialChars);

    if (isWeakSecret) {
      if (isProduction) {
        logger.warn('NEXTAUTH_SECRET does not meet production security standards', {
          socketId: socket.id,
          secretLength: secret.length,
          hasAlphanumeric,
          hasSpecialChars,
          recommendation: 'Use a strong random secret (32+ chars, mixed alphanumeric + special chars). Generate with: openssl rand -base64 32',
        });
        return null;
      }
      // In development, log warning but allow (for development convenience)
      if (secret === 'development-secret-change-in-production' || secret.length < MIN_SECRET_LENGTH) {
        logger.debug('Using weak NEXTAUTH_SECRET in development (not recommended for production)', {
          socketId: socket.id,
        });
      }
    }

    // Decode and verify JWT token
    // NextAuth v5 uses jose library for JWT encoding/decoding
    // The secret is used to verify the token signature
    try {
      const secretKey = new TextEncoder().encode(secret);
      const { payload } = await jwtVerify(sessionToken, secretKey);

      // Extract user information from JWT payload
      // NextAuth v5 JWT payload structure:
      // { sub: userId, email: user.email, name: user.name, iat: issuedAt, exp: expiresAt }
      const userId = payload.sub;
      const email = payload.email as string | undefined;
      const name = payload.name as string | undefined;

      if (!userId || !email) {
        logger.warn('Invalid JWT payload: missing userId or email', {
          socketId: socket.id,
          payload: { sub: userId, email },
        });
        return null;
      }

      // Verify user exists in database and get full user info
      const user = getUserByEmail(email);
      if (!user) {
        logger.warn('User not found in database for authenticated session', {
          socketId: socket.id,
          email,
        });
        return null;
      }

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name || undefined,
          isAuthenticated: true,
        },
      };
    } catch (decodeError) {
      // JWT decode/verification failed - invalid token or wrong secret
      logger.debug('Failed to decode/verify JWT token', {
        socketId: socket.id,
        error: decodeError instanceof Error ? decodeError.message : String(decodeError),
      });
      return null;
    }
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
 * In production, requires authentication; in development, allows anonymous connections
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

    // Check if we're in production - require authentication
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      logger.warn('Rejecting anonymous connection in production', {
        socketId: socket.id,
      });
      return false;
    }

    // Anonymous user - allow in development only
    socket.data.user = {
      id: `anonymous-${socket.id}`,
      isAuthenticated: false,
    };

    logger.info('Socket connected as anonymous (development mode)', {
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
