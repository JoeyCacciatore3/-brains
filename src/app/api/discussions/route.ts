import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getUserDiscussions } from '@/lib/db/discussions';
import { getUserByEmail } from '@/lib/db/users';
import { logger } from '@/lib/logger';
import { checkRateLimitWithHeaders, addRateLimitHeaders, getClientIP } from '@/lib/api-helpers';

// Mark route as dynamic since it uses auth() which accesses headers and request headers
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Check rate limit
    const rateLimitCheck = await checkRateLimitWithHeaders(request);
    if (rateLimitCheck.exceeded && rateLimitCheck.response) {
      return rateLimitCheck.response;
    }

    // NextAuth v5 in Next.js 16 automatically reads from request context
    const session = await auth();
    if (!session?.user?.email) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return addRateLimitHeaders(response, getClientIP(request));
    }

    const user = getUserByEmail(session.user.email);
    if (!user) {
      const response = NextResponse.json({ error: 'User not found' }, { status: 404 });
      return addRateLimitHeaders(response, getClientIP(request));
    }

    const discussions = getUserDiscussions(user.id);
    const response = NextResponse.json({ discussions });
    return addRateLimitHeaders(response, getClientIP(request));
  } catch (error) {
    logger.error('Error fetching discussions:', { error });
    const response = NextResponse.json({ error: 'Failed to fetch discussions' }, { status: 500 });
    return addRateLimitHeaders(response, getClientIP(request));
  }
}
