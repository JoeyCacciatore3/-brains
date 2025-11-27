/**
 * API Helper Functions
 *
 * Common utilities for API routes including rate limiting and headers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getRateLimitInfo } from '@/lib/rate-limit';
import { ErrorCode, createErrorFromCode } from '@/lib/errors';
import { getUserRateLimitTier } from '@/lib/rate-limit-tier';
import type { RateLimitTier } from './config';

/**
 * Extract client IP from request
 */
export function getClientIP(request: NextRequest): string {
  // Try x-forwarded-for header first (for proxy scenarios)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ips = forwardedFor.split(',');
    const clientIp = ips[0]?.trim();
    if (clientIp) {
      return clientIp;
    }
  }

  // Fall back to remote address from headers
  const remoteAddress = request.headers.get('x-real-ip') || 'unknown';

  return remoteAddress;
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(
  response: NextResponse,
  ip: string,
  tier: RateLimitTier = 'anonymous'
): NextResponse {
  const rateLimitInfo = getRateLimitInfo(ip, tier);

  response.headers.set('X-RateLimit-Limit', rateLimitInfo.limit.toString());
  response.headers.set('X-RateLimit-Remaining', rateLimitInfo.remaining.toString());
  response.headers.set('X-RateLimit-Reset', Math.floor(rateLimitInfo.reset / 1000).toString());
  response.headers.set('X-RateLimit-Tier', tier);

  return response;
}

/**
 * Check rate limit and return error response if exceeded
 * Also adds rate limit headers to response
 * @param request - Next.js request object
 * @param session - Optional session object to determine user tier
 * @param userId - Optional user ID to determine user tier
 */
export async function checkRateLimitWithHeaders(
  request: NextRequest,
  session?: { user?: { email?: string | null; id?: string; premium?: boolean } } | null,
  userId?: string
): Promise<{ exceeded: boolean; response?: NextResponse; tier?: RateLimitTier }> {
  const ip = getClientIP(request);
  const tier = getUserRateLimitTier(userId, session);
  const exceeded = await checkRateLimit(ip, tier);

  if (exceeded) {
    const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED, { ip });
    const response = NextResponse.json(
      { error: error.message, code: error.code },
      { status: 429 }
    );
    return { exceeded: true, response: addRateLimitHeaders(response, ip, tier), tier };
  }

  return { exceeded: false, tier };
}
