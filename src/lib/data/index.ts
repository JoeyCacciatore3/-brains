/**
 * Unified Data Access Layer
 *
 * This module provides a single source of truth for all data operations.
 * It enforces clear separation between database (metadata) and files (content).
 *
 * Architecture:
 * - Database: Metadata, indexing, queries (src/lib/db/discussions.ts)
 * - Files: Full content, rounds, messages (src/lib/discussions/file-manager.ts)
 */

import type { Discussion } from '@/lib/db/discussions';
import type {
  DiscussionRound,
  SummaryEntry,
  QuestionSet,
} from '@/types';
import type { DiscussionData } from '@/lib/discussions/formatter';
import {
  createDiscussion as createDiscussionDB,
  getDiscussion,
  updateDiscussion,
  syncTokenCountFromFile,
  getAllDiscussions,
} from '@/lib/db/discussions';
import {
  createDiscussion as createDiscussionFiles,
  readDiscussion,
  addRoundToDiscussion,
  addQuestionSetToDiscussion,
  updateRoundAnswers,
  addSummaryToDiscussion,
  updateDiscussionWithSummary,
} from '@/lib/discussions/file-manager';
import { calculateDiscussionTokenCount } from '@/lib/discussions/token-counter';
import { logger } from '@/lib/logger';

/**
 * Create a new discussion
 * Creates both database metadata and file structure
 */
export async function createDiscussion(
  userId: string,
  topic: string,
  discussionId?: string
): Promise<{ discussion: Discussion; filePaths: { json: string; md: string } }> {
  // Create file structure first (file manager generates paths)
  const fileResult = await createDiscussionFiles(userId, topic, discussionId);
  const actualId = discussionId || fileResult.id;

  // Create database metadata
  const _discussion = createDiscussionDB(
    userId,
    topic,
    fileResult.jsonPath,
    fileResult.mdPath,
    actualId
  );

  logger.debug('Discussion created', {
    discussionId: actualId,
    userId,
    topic: topic.substring(0, 50),
  });

  return {
    discussion,
    filePaths: { json: fileResult.jsonPath, md: fileResult.mdPath }
  };
}

/**
 * Get discussion metadata from database
 */
export function getDiscussionMetadata(discussionId: string, userId: string): Discussion | null {
  return getDiscussion(discussionId, userId);
}

/**
 * Get full discussion data (metadata + content)
 * Combines database metadata with file content
 */
export async function getFullDiscussion(
  discussionId: string,
  userId: string
): Promise<{ metadata: Discussion; content: DiscussionData } | null> {
  const metadata = getDiscussion(discussionId, userId);
  if (!metadata) {
    return null;
  }

  // Verify user ownership
  if (metadata.user_id !== userId) {
    logger.warn('User attempted to access discussion they do not own', {
      discussionId,
      userId,
      ownerId: metadata.user_id,
    });
    return null;
  }

  const content = await readDiscussion(discussionId, userId);
  return { metadata, content };
}

/**
 * Add a round to discussion
 * Updates file content and syncs token count to database
 */
export async function addRound(
  discussionId: string,
  userId: string,
  round: DiscussionRound
): Promise<void> {
  // Add round to file storage (source of truth for content)
  await addRoundToDiscussion(discussionId, userId, round);

  // Sync token count from file to database using centralized function
  // Option A: Database stores full context token count including overhead (matches loadDiscussionContext)
  const discussionData = await readDiscussion(discussionId, userId);
  const totalTokens = calculateDiscussionTokenCount(discussionData, {
    includeSystemPrompts: true,
    includeFormattingOverhead: true,
  });

  syncTokenCountFromFile(discussionId, totalTokens);
}

/**
 * Add questions to a round
 * Updates file content only (questions are part of content)
 */
export async function addQuestions(
  discussionId: string,
  userId: string,
  questionSet: QuestionSet
): Promise<void> {
  await addQuestionSetToDiscussion(discussionId, userId, questionSet);
}

/**
 * Update round answers
 * Updates file content only
 */
export async function updateAnswers(
  discussionId: string,
  userId: string,
  roundNumber: number,
  answers: Record<string, string[]>
): Promise<void> {
  await updateRoundAnswers(discussionId, userId, roundNumber, answers);
}

/**
 * Add summary to discussion
 * Updates both file content and database metadata
 */
export async function addSummary(
  discussionId: string,
  userId: string,
  summary: SummaryEntry
): Promise<void> {
  // Add summary to file storage (source of truth for content)
  await addSummaryToDiscussion(discussionId, userId, summary);

  // Update database metadata with summary info (legacy format for compatibility)
  await updateDiscussionWithSummary(discussionId, userId, summary.summary);
}

/**
 * Update discussion metadata
 * Updates database only (metadata operations)
 */
export function updateDiscussionMetadata(
  discussionId: string,
  updates: Partial<Discussion>
): void {
  updateDiscussion(discussionId, updates);
}

/**
 * Get all discussions for a user
 * Returns metadata only (from database)
 */
export function getUserDiscussions(userId: string): Discussion[] {
  return getAllDiscussions().filter((d) => d.user_id === userId);
}

/**
 * Sync token count from file to database
 * File storage is authoritative for token counts
 */
export async function syncTokenCount(discussionId: string, userId: string): Promise<void> {
  const discussionData = await readDiscussion(discussionId, userId);
  // Calculate token count using centralized function
  // Option A: Database stores full context token count including overhead (matches loadDiscussionContext)
  const totalTokens = calculateDiscussionTokenCount(discussionData, {
    includeSystemPrompts: true,
    includeFormattingOverhead: true,
  });

  syncTokenCountFromFile(discussionId, totalTokens);
}
