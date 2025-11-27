/**
 * Rate Limit Tier Detection Utility
 * Determines user tier based on authentication status and user properties
 */

import type { RateLimitTier } from './config';

/**
 * Session type (minimal interface for tier detection)
 */
interface Session {
  user?: {
    email?: string;
    id?: string;
    role?: string;
    premium?: boolean;
  };
}

/**
 * Get rate limit tier for a user based on authentication status
 * @param userId - Optional user ID (anonymous if not provided)
 * @param session - Optional session object to check authentication
 * @returns Rate limit tier: 'anonymous' | 'authenticated' | 'premium'
 */
export function getUserRateLimitTier(
  userId?: string,
  session?: Session | { user?: { email?: string | null; id?: string; premium?: boolean } } | null
): RateLimitTier {
  // Check for premium tier (future use - when premium status is implemented)
  if (session?.user?.premium === true) {
    return 'premium';
  }

  // Check for authenticated tier
  if (userId && userId.startsWith('user-')) {
    // Authenticated user IDs typically start with 'user-'
    return 'authenticated';
  }

  if (session?.user?.email || session?.user?.id) {
    return 'authenticated';
  }

  // Default to anonymous tier
  return 'anonymous';
}

/**
 * Check if user is authenticated
 * Helper function for tier detection
 */
export function isAuthenticated(session?: Session | null): boolean {
  return !!(session?.user?.email || session?.user?.id);
}
