/**
 * Socket.IO Authorization Helpers
 *
 * Verifies user ownership of discussions before allowing operations.
 */

import { getDiscussion } from '@/lib/db/discussions';
import { logger } from '@/lib/logger';
import { ErrorCode, createErrorFromCode } from '@/lib/errors';

/**
 * Verify that a user owns a discussion
 * @param discussionId - Discussion ID to verify
 * @param userId - User ID to check ownership against
 * @returns true if user owns the discussion, false otherwise
 */
export function verifyDiscussionOwnership(discussionId: string, userId: string): boolean {
  try {
    const discussion = getDiscussion(discussionId);
    if (!discussion) {
      logger.warn('Discussion not found for ownership verification', {
        discussionId,
        userId,
      });
      return false;
    }

    // Check if user owns the discussion
    // Anonymous users can only access discussions they created (matching anonymous-{socketId} pattern)
    const ownsDiscussion = discussion.user_id === userId;

    if (!ownsDiscussion) {
      logger.warn('User attempted to access discussion they do not own', {
        discussionId,
        userId,
        discussionOwner: discussion.user_id,
      });
    }

    return ownsDiscussion;
  } catch (error) {
    logger.error('Error verifying discussion ownership', {
      error: error instanceof Error ? error.message : String(error),
      discussionId,
      userId,
    });
    return false;
  }
}

/**
 * Create authorization error response
 */
export function createAuthorizationError(discussionId?: string): {
  message: string;
  code: string;
  discussionId?: string;
} {
  const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, {
    reason: 'unauthorized_access',
  });
  return {
    message: 'You do not have permission to access this discussion.',
    code: error.code,
    discussionId,
  };
}
