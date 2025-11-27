import NextAuth, { type NextAuthConfig } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import { randomUUID } from 'crypto';
import { getDatabase } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * NextAuth configuration with OAuth providers
 *
 * Note: NextAuth v5 automatically uses NEXTAUTH_URL if set, or falls back to
 * the request URL. For production, it's recommended to set NEXTAUTH_URL explicitly.
 * OAuth callback URLs are automatically constructed as: {NEXTAUTH_URL}/api/auth/callback/{provider}
 */

/**
 * Validate NEXTAUTH_URL configuration
 * Warns in production if NEXTAUTH_URL is missing or invalid
 */
function validateNextAuthUrl(): void {
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  const isProduction = process.env.NODE_ENV === 'production';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (isProduction) {
    if (!nextAuthUrl) {
      logger.warn(
        'NEXTAUTH_URL is not set in production. OAuth callbacks may fail. ' +
          'Set NEXTAUTH_URL to your production domain (e.g., https://yourdomain.com)'
      );
    } else if (!nextAuthUrl.startsWith('https://')) {
      logger.warn(
        'NEXTAUTH_URL should use HTTPS in production. Current value: ' + nextAuthUrl
      );
    }
  } else {
    // Development mode: log for debugging
    if (nextAuthUrl) {
      logger.debug('NEXTAUTH_URL configured', { nextAuthUrl });
    } else if (appUrl) {
      logger.debug('NEXTAUTH_URL not set, will use NEXT_PUBLIC_APP_URL or request URL', {
        appUrl,
      });
    }
  }
}

/**
 * Construct callback URL for a provider
 * Used for validation and debugging
 */
function getCallbackUrl(provider: string): string {
  const baseUrl =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000';
  return `${baseUrl}/api/auth/callback/${provider}`;
}

// Note: NEXTAUTH_URL validation moved to runtime initialization

/**
 * Lazy provider initialization function
 * Checks environment variables at runtime when called, not at module load time
 * This ensures providers are available when Next.js has loaded .env.local
 */
function getProviders() {
  const providers = [];

  // Check for GitHub OAuth credentials at runtime
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (githubClientId && githubClientSecret) {
    const githubProvider = GitHubProvider({
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    });
    providers.push(githubProvider);

    // Log callback URL for debugging (development only)
    if (process.env.NODE_ENV === 'development') {
      logger.debug('GitHub OAuth provider configured at runtime', {
        callbackUrl: getCallbackUrl('github'),
        hasClientId: !!githubClientId,
        hasClientSecret: !!githubClientSecret,
      });
    }
  } else {
    // Only warn at runtime if we're actually trying to use auth
    // Don't warn during module load as env vars might not be loaded yet
    if (process.env.NODE_ENV === 'development') {
      logger.debug('GitHub OAuth credentials not available at runtime', {
        hasClientId: !!githubClientId,
        hasClientSecret: !!githubClientSecret,
      });
    }
  }

  // Log provider status
  if (providers.length === 0) {
    logger.warn('No OAuth providers configured at runtime. Authentication will be disabled.', {
      checkedClientId: !!githubClientId,
      checkedClientSecret: !!githubClientSecret,
    });
  } else {
    logger.info(`OAuth providers configured at runtime: ${providers.length} provider(s)`, {
      providers: providers.map((p) => p.id || 'unknown'),
    });
  }

  return providers;
}

/**
 * Base auth configuration without providers
 * Providers will be added lazily when NextAuth instance is initialized
 */
function getAuthOptions(providers: ReturnType<typeof getProviders>): NextAuthConfig {
  return {
    providers,
  callbacks: {
    async signIn({ user, account }) {
      if (!account || !user.email) {
        logger.warn('Sign-in attempt without account or email', {
          hasAccount: !!account,
          hasEmail: !!user.email,
        });
        return false;
      }

      try {
        let db;
        try {
          db = getDatabase();
        } catch (dbError) {
          logger.error('Failed to get database connection in signIn callback', {
            error: dbError instanceof Error ? dbError.message : String(dbError),
            email: user.email,
            provider: account.provider,
          });
          // Return false to reject sign-in if database is unavailable
          return false;
        }

        const now = Date.now();

        // Check if user exists by email (for same email from different providers)
        const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(user.email) as
          | { id: string }
          | undefined;

        // Check if provider account already exists (enforces UNIQUE(provider, provider_id))
        const existingProviderAccount = db
          .prepare('SELECT id FROM users WHERE provider = ? AND provider_id = ?')
          .get(account.provider, account.providerAccountId || account.id || '') as
          | { id: string }
          | undefined;

        if (existingProviderAccount) {
          // Provider account exists - update user info
          db.prepare(
            `UPDATE users
             SET name = ?, image = ?, updated_at = ?
             WHERE id = ?`
          ).run(user.name || null, user.image || null, now, existingProviderAccount.id);
          logger.debug('User updated via provider account', {
            userId: existingProviderAccount.id,
            email: user.email,
            provider: account.provider,
          });
          return true;
        }

        if (existingUser) {
          // User exists with same email but different provider
          // This is an edge case - same email from different providers
          // For now, we'll update the existing user's info
          // Note: Database constraint UNIQUE(provider, provider_id) prevents duplicate provider accounts
          db.prepare(
            `UPDATE users
             SET name = ?, image = ?, updated_at = ?
             WHERE id = ?`
          ).run(user.name || null, user.image || null, now, existingUser.id);
          logger.info('User updated (existing email, different provider)', {
            userId: existingUser.id,
            email: user.email,
            provider: account.provider,
          });
          return true;
        }

        // Create new user with unique ID (randomUUID is cryptographically secure)
        const userId = randomUUID();
        try {
          db.prepare(
            `INSERT INTO users (id, email, name, image, provider, provider_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            userId,
            user.email,
            user.name || null,
            user.image || null,
            account.provider || 'unknown',
            account.providerAccountId || account.id || '',
            now,
            now
          );

          logger.info('New user created', {
            userId,
            email: user.email,
            provider: account.provider,
            providerId: account.providerAccountId || account.id || '',
          });
          return true;
        } catch (dbError) {
          // Handle database constraint violations (shouldn't happen with randomUUID, but handle gracefully)
          if (
            dbError instanceof Error &&
            (dbError.message.includes('UNIQUE constraint') ||
              dbError.message.includes('PRIMARY KEY'))
          ) {
            logger.error('Database constraint violation (unexpected)', {
              error: dbError.message,
              userId,
              email: user.email,
              provider: account.provider,
            });
            // Try to get existing user
            const conflictUser = db
              .prepare('SELECT id FROM users WHERE email = ? OR (provider = ? AND provider_id = ?)')
              .get(
                user.email,
                account.provider,
                account.providerAccountId || account.id || ''
              ) as { id: string } | undefined;
            if (conflictUser) {
              logger.warn('User already exists, updating instead', {
                userId: conflictUser.id,
                email: user.email,
              });
              db.prepare(
                `UPDATE users
                 SET name = ?, image = ?, updated_at = ?
                 WHERE id = ?`
              ).run(user.name || null, user.image || null, now, conflictUser.id);
              return true;
            }
          }
          throw dbError;
        }
      } catch (error) {
        logger.error('Error in signIn callback', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          email: user.email,
          provider: account?.provider,
          hasAccount: !!account,
          hasUser: !!user,
        });
        // Return false to reject sign-in on any error
        return false;
      }
    },
    async session({ session }) {
      if (session.user?.email) {
        try {
          let db;
          try {
            db = getDatabase();
          } catch (dbError) {
            logger.error('Failed to get database connection in session callback', {
              error: dbError instanceof Error ? dbError.message : String(dbError),
              email: session.user.email,
            });
            // Return session without user ID if database is unavailable
            return session;
          }
          const user = db
            .prepare('SELECT id FROM users WHERE email = ?')
            .get(session.user.email) as { id: string } | undefined;

          if (user) {
            if (session.user) {
              // Attach user ID to session for use in socket middleware
              // JWT payload will include: { sub: user.id, email: user.email, name: user.name }
              (session.user as { id?: string }).id = user.id;
            }
          } else {
            logger.warn('User not found in database for session', {
              email: session.user.email,
            });
          }
        } catch (error) {
          logger.error('Error fetching user ID in session callback', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            email: session.user.email,
          });
          // Return session without user ID on error (still allow session to exist)
        }
      }
      return session;
    },
    async jwt({ token, user, account: _account }) {
      // NextAuth v5 JWT callback - ensure user ID is in token
      // JWT payload structure must match socket middleware expectations:
      // { sub: userId, email: user.email, name: user.name, iat: issuedAt, exp: expiresAt }
      // Socket middleware (auth-middleware.ts) expects:
      // - payload.sub: user ID (required)
      // - payload.email: user email (required)
      // - payload.name: user name (optional)
      if (user?.email) {
        try {
          let db;
          try {
            db = getDatabase();
          } catch (dbError) {
            logger.error('Failed to get database connection in JWT callback', {
              error: dbError instanceof Error ? dbError.message : String(dbError),
              email: user.email,
            });
            // Return token without user ID if database is unavailable
            return token;
          }
          const dbUser = db
            .prepare('SELECT id FROM users WHERE email = ?')
            .get(user.email) as { id: string } | undefined;

          if (dbUser) {
            // Set sub (subject) to user ID - this is what socket middleware expects
            token.sub = dbUser.id;
            token.email = user.email;
            token.name = user.name || undefined;

            if (process.env.NODE_ENV === 'development') {
              logger.debug('JWT token updated with user info', {
                userId: dbUser.id,
                email: user.email,
                hasName: !!user.name,
              });
            }
          }
        } catch (error) {
          logger.error('Error setting user ID in JWT token', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            email: user.email,
          });
          // Return token without user ID on error (still allow token to exist)
        }
      }
      return token;
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
  // Secret is required for NextAuth v5
  // In production, fail fast if secret is missing or using default
  secret: (() => {
    const secret = process.env.NEXTAUTH_SECRET;
    const isProduction = process.env.NODE_ENV === 'production';
    const defaultSecret = 'development-secret-change-in-production';

    if (isProduction) {
      if (!secret || secret === defaultSecret) {
        const errorMessage =
          'NEXTAUTH_SECRET is required in production and must not be the default value. ' +
          'Please set a strong, random secret in your environment variables. ' +
          'You can generate one with: openssl rand -base64 32';
        logger.error(errorMessage);
        throw new Error(errorMessage);
      }
    }

    // In development, allow fallback to default secret
    return secret || defaultSecret;
  })(),
  };
}

// Lazy NextAuth instance - will be initialized when first accessed
let nextAuthInstance: ReturnType<typeof NextAuth> | null = null;

function initializeNextAuth() {
  if (!nextAuthInstance) {
    // Validate NEXTAUTH_URL at runtime
    validateNextAuthUrl();

    // Re-evaluate providers at runtime when NextAuth is initialized
    // This ensures environment variables are loaded by Next.js
    const runtimeProviders = getProviders();

    logger.debug('Initializing NextAuth instance at runtime', {
      providerCount: runtimeProviders.length,
      providers: runtimeProviders.map((p) => p.id || 'unknown'),
    });

    // Create config with runtime providers
    const runtimeAuthOptions = getAuthOptions(runtimeProviders);

    nextAuthInstance = NextAuth(runtimeAuthOptions);
  }
  return nextAuthInstance;
}

// Export function to get NextAuth instance (lazy initialization)
export function getNextAuthInstance() {
  return initializeNextAuth();
}

// Export auth helper functions that use lazy initialization
export function auth(...args: Parameters<ReturnType<typeof NextAuth>['auth']>) {
  return initializeNextAuth().auth(...args);
}

export function signIn(...args: Parameters<ReturnType<typeof NextAuth>['signIn']>) {
  return initializeNextAuth().signIn(...args);
}

export function signOut(...args: Parameters<ReturnType<typeof NextAuth>['signOut']>) {
  return initializeNextAuth().signOut(...args);
}

// Export helpers for getting providers and auth options
export { getProviders, getAuthOptions };

/**
 * Type-safe wrapper for getting auth session
 * Handles NextAuth v5 types properly without using type assertions
 * @returns Promise resolving to session or null if not authenticated
 */
export async function getAuthSession() {
  try {
    const nextAuthInstance = initializeNextAuth();
    const session = await nextAuthInstance.auth();
    return session;
  } catch (error) {
    logger.error('Failed to get auth session', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
