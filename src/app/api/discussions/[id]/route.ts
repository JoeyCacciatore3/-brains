import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth/config';
import { deleteDiscussion, markDiscussionAsResolved } from '@/lib/db/discussions';
import { deleteDiscussionFiles } from '@/lib/discussions/file-manager';
import { getUserByEmail } from '@/lib/db/users';
import { logger } from '@/lib/logger';
import { checkRateLimitWithHeaders, addRateLimitHeaders, getClientIP } from '@/lib/api-helpers';
import { discussionIdSchema } from '@/lib/validation';

// Mark route as dynamic since it uses auth() which accesses headers and request headers
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // NextAuth v5 in Next.js 16 reads from request context automatically
    const session = await getAuthSession();

    // Check rate limit with tier based on session
    const userId = session?.user?.email ? getUserByEmail(session.user.email)?.id : undefined;
    const rateLimitCheck = await checkRateLimitWithHeaders(request, session, userId);
    if (rateLimitCheck.exceeded && rateLimitCheck.response) {
      return rateLimitCheck.response;
    }
    if (!session?.user?.email) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
    }

    const user = getUserByEmail(session.user.email);
    if (!user) {
      const response = NextResponse.json({ error: 'User not found' }, { status: 404 });
      return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
    }

    const { id: discussionId } = await params;
    if (!discussionId) {
      const response = NextResponse.json({ error: 'Discussion ID is required' }, { status: 400 });
      return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
    }

    // Validate UUID format
    const uuidValidation = discussionIdSchema.safeParse(discussionId);
    if (!uuidValidation.success) {
      const response = NextResponse.json(
        { error: 'Invalid discussion ID format', details: uuidValidation.error.issues },
        { status: 400 }
      );
      return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
    }

    // Delete files first, then database entry
    try {
      await deleteDiscussionFiles(user.id, discussionId);
      deleteDiscussion(discussionId, user.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error deleting discussion', {
        discussionId,
        userId: user.id,
        error: errorMessage,
      });

      if (errorMessage.includes('not found') || errorMessage.includes('access denied')) {
        const response = NextResponse.json(
          { error: 'Discussion not found or access denied' },
          { status: 404 }
        );
        return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
      }

      const response = NextResponse.json(
        { error: 'Failed to delete discussion' },
        { status: 500 }
      );
      return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
    }

    const response = NextResponse.json({ success: true });
    return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
  } catch (error) {
    logger.error('Error in DELETE /api/discussions/[id]:', { error });
    const response = NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    return addRateLimitHeaders(response, getClientIP(request));
  }
}

/**
 * PATCH /api/discussions/[id] - Mark a discussion as resolved
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // NextAuth v5 in Next.js 16 reads from request context automatically
    const session = await getAuthSession();

    // Check rate limit with tier based on session
    const userId = session?.user?.email ? getUserByEmail(session.user.email)?.id : undefined;
    const rateLimitCheck = await checkRateLimitWithHeaders(request, session, userId);
    if (rateLimitCheck.exceeded && rateLimitCheck.response) {
      return rateLimitCheck.response;
    }

    if (!session?.user?.email) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
    }

    const user = getUserByEmail(session.user.email);
    if (!user) {
      const response = NextResponse.json({ error: 'User not found' }, { status: 404 });
      return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
    }

    const { id: discussionId } = await params;
    if (!discussionId) {
      const response = NextResponse.json({ error: 'Discussion ID is required' }, { status: 400 });
      return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
    }

    // Validate UUID format
    const uuidValidation = discussionIdSchema.safeParse(discussionId);
    if (!uuidValidation.success) {
      const response = NextResponse.json(
        { error: 'Invalid discussion ID format', details: uuidValidation.error.issues },
        { status: 400 }
      );
      return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
    }

    // Parse request body to get action
    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const action = body.action || 'resolve';

    if (action === 'resolve') {
      try {
        markDiscussionAsResolved(discussionId, user.id);
        const response = NextResponse.json({ success: true, action: 'resolve' });
        return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Error resolving discussion', {
          discussionId,
          userId: user.id,
          error: errorMessage,
        });

        if (errorMessage.includes('not found') || errorMessage.includes('access denied')) {
          const response = NextResponse.json(
            { error: 'Discussion not found or access denied' },
            { status: 404 }
          );
          return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
        }

        const response = NextResponse.json(
          { error: 'Failed to resolve discussion' },
          { status: 500 }
        );
        return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
      }
    } else {
      const response = NextResponse.json({ error: 'Invalid action' }, { status: 400 });
      return addRateLimitHeaders(response, getClientIP(request), rateLimitCheck.tier || 'anonymous');
    }
  } catch (error) {
    logger.error('Error in PATCH /api/discussions/[id]:', { error });
    const response = NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    return addRateLimitHeaders(response, getClientIP(request));
  }
}
