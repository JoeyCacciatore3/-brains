import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import {
  getUserDiscussions,
  deleteAllUserDiscussions,
  resolveAllUserDiscussions,
} from '@/lib/db/discussions';
import { deleteAllUserDiscussionFiles } from '@/lib/discussions/file-manager';
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

/**
 * DELETE /api/discussions - Delete all discussions for the authenticated user
 */
export async function DELETE(request: NextRequest) {
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

    // Parse query parameters to determine action
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action'); // 'delete' or 'resolve'

    if (action === 'resolve') {
      // Mark all discussions as resolved
      const resolvedCount = resolveAllUserDiscussions(user.id);
      const response = NextResponse.json({
        success: true,
        action: 'resolve',
        resolvedCount,
      });
      return addRateLimitHeaders(response, getClientIP(request));
    } else {
      // Delete all discussions (default action)
      // Delete files first, then database entries
      let filesDeleted = 0;
      try {
        filesDeleted = await deleteAllUserDiscussionFiles(user.id);
      } catch (error) {
        logger.error('Error deleting discussion files', {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with database deletion even if file deletion fails
      }

      const discussionsDeleted = deleteAllUserDiscussions(user.id);

      const response = NextResponse.json({
        success: true,
        action: 'delete',
        discussionsDeleted,
        filesDeleted,
      });
      return addRateLimitHeaders(response, getClientIP(request));
    }
  } catch (error) {
    logger.error('Error in DELETE /api/discussions:', { error });
    const response = NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    return addRateLimitHeaders(response, getClientIP(request));
  }
}
