import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import type { ConversationMessage, DiscussionRound, SummaryEntry, QuestionSet } from '@/types';
import {
  formatDiscussionJSON,
  formatDiscussionMarkdown,
  parseDiscussionJSON,
  type DiscussionData,
} from './formatter';
import { countTokens } from './token-counter';
import { withLock } from './file-lock';
import { backupDiscussion } from './backup-manager';
import { BACKUP_CONFIG } from '@/lib/config';

const DISCUSSIONS_DIR =
  process.env.DISCUSSIONS_DIR || path.join(process.cwd(), 'data', 'discussions');

/**
 * Retry configuration for file operations
 */
const FILE_OPERATION_RETRY_CONFIG = {
  MAX_ATTEMPTS: parseInt(process.env.FILE_OPERATION_MAX_RETRIES || '3', 10),
  INITIAL_DELAY_MS: parseInt(process.env.FILE_OPERATION_RETRY_DELAY_MS || '100', 10),
};

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a file operation with exponential backoff
 *
 * @param operation - Async function to retry
 * @param context - Context for logging (discussionId, userId, operation name)
 * @returns Result of the operation
 * @throws Error if all retries fail
 */
/**
 * Categorize error as transient (retryable) or permanent (not retryable)
 */
function categorizeError(error: unknown): { isTransient: boolean; category: string } {
  if (!(error instanceof Error)) {
    return { isTransient: false, category: 'unknown' };
  }

  const errorMessage = error.message.toLowerCase();
  const errorCode = (error as { code?: string }).code?.toLowerCase() || '';

  // Permanent errors (don't retry)
  const permanentPatterns = [
    'does not belong to user',
    'invalid',
    'not found',
    'permission denied',
    'eacces',
    'eisdir',
    'enoent', // File not found (permanent)
    'corrupted',
    'invalid format',
    'validation',
  ];

  // Transient errors (retry)
  const transientPatterns = [
    'eagain',
    'ebusy',
    'elocked',
    'eio',
    'enospc', // No space (might be transient)
    'emfile', // Too many open files (might be transient)
    'timeout',
    'network',
    'econnreset',
    'enotfound', // Network not found (transient)
    'temporary',
  ];

  // Check for permanent errors first
  for (const pattern of permanentPatterns) {
    if (errorMessage.includes(pattern) || errorCode.includes(pattern)) {
      return { isTransient: false, category: 'permanent' };
    }
  }

  // Check for transient errors
  for (const pattern of transientPatterns) {
    if (errorMessage.includes(pattern) || errorCode.includes(pattern)) {
      return { isTransient: true, category: 'transient' };
    }
  }

  // Default: treat as transient (safer to retry than to fail immediately)
  // But log for monitoring
  logger.debug('Uncategorized error, treating as transient', {
    error: errorMessage,
    code: errorCode,
  });
  return { isTransient: true, category: 'uncategorized' };
}

async function retryFileOperation<T>(
  operation: () => Promise<T>,
  context: { discussionId?: string; userId?: string; operation: string }
): Promise<T> {
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= FILE_OPERATION_RETRY_CONFIG.MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === FILE_OPERATION_RETRY_CONFIG.MAX_ATTEMPTS;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Categorize error
      const { isTransient, category } = categorizeError(error);

      // Don't retry permanent errors
      if (!isTransient) {
        logger.warn('File operation failed with permanent error, not retrying', {
          ...context,
          attempt,
          error: errorMessage,
          category,
        });
        throw error;
      }

      if (isLastAttempt) {
        logger.error('File operation failed after all retries', {
          ...context,
          attempt,
          maxAttempts: FILE_OPERATION_RETRY_CONFIG.MAX_ATTEMPTS,
          error: errorMessage,
          category,
        });
        throw error;
      }

      // Exponential backoff: delay = initialDelay * 2^(attempt - 1)
      const delay = FILE_OPERATION_RETRY_CONFIG.INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn('File operation failed (transient error), retrying', {
        ...context,
        attempt,
        maxAttempts: FILE_OPERATION_RETRY_CONFIG.MAX_ATTEMPTS,
        retryDelayMs: delay,
        error: errorMessage,
        category,
      });

      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Atomically write both JSON and Markdown files using temp files + rename pattern
 * This ensures both files are written successfully before replacing originals,
 * preventing partial writes that could leave files out of sync.
 *
 * @param jsonPath - Path to the JSON file
 * @param mdPath - Path to the Markdown file
 * @param jsonContent - Content for the JSON file
 * @param mdContent - Content for the Markdown file
 */
async function writeDiscussionFilesAtomically(
  jsonPath: string,
  mdPath: string,
  jsonContent: string,
  mdContent: string
): Promise<void> {
  // Generate temp file paths with timestamp for easier cleanup
  const timestamp = Date.now();
  const jsonTempPath = `${jsonPath}.tmp.${timestamp}.${randomUUID()}`;
  const mdTempPath = `${mdPath}.tmp.${timestamp}.${randomUUID()}`;

  let originalError: Error | unknown;
  const cleanupErrors: Array<{ file: string; error: Error | unknown }> = [];

  try {
    // Write to temp files first
    await Promise.all([
      fs.writeFile(jsonTempPath, jsonContent, 'utf-8'),
      fs.writeFile(mdTempPath, mdContent, 'utf-8'),
    ]);

    // Verify both temp files were written successfully
    await Promise.all([fs.access(jsonTempPath), fs.access(mdTempPath)]);

    // Atomically rename temp files to final names (rename is atomic on most filesystems)
    await Promise.all([fs.rename(jsonTempPath, jsonPath), fs.rename(mdTempPath, mdPath)]);

    // Verify both files exist after rename (check for non-atomic filesystem issues)
    try {
      await Promise.all([fs.access(jsonPath), fs.access(mdPath)]);
    } catch (verifyError) {
      // If verification fails, one or both files may not have been renamed
      // This can happen on non-atomic filesystems (e.g., network filesystems)
      logger.error('File rename verification failed - possible non-atomic filesystem issue', {
        jsonPath,
        mdPath,
        error: verifyError instanceof Error ? verifyError.message : String(verifyError),
      });
      throw new Error(
        'File rename verification failed. This may indicate a filesystem compatibility issue.'
      );
    }
  } catch (error) {
    originalError = error;

    // Clean up temp files if they exist
    // Log cleanup errors separately before throwing original error
    const cleanupPromises = [
      fs
        .unlink(jsonTempPath)
        .catch((cleanupError) => {
          cleanupErrors.push({ file: jsonTempPath, error: cleanupError });
        }),
      fs
        .unlink(mdTempPath)
        .catch((cleanupError) => {
          cleanupErrors.push({ file: mdTempPath, error: cleanupError });
        }),
    ];

    await Promise.all(cleanupPromises);

    // Log cleanup errors if any occurred
    if (cleanupErrors.length > 0) {
      logger.warn('Failed to cleanup some temp files after error', {
        cleanupErrors: cleanupErrors.map((e) => ({
          file: e.file,
          error: e.error instanceof Error ? e.error.message : String(e.error),
        })),
        originalError: originalError instanceof Error ? originalError.message : String(originalError),
      });
    }

    // Throw original error
    throw originalError;
  }
}

/**
 * Ensure discussions directory exists for a user
 */
async function ensureUserDirectory(userId: string): Promise<string> {
  const userDir = path.join(DISCUSSIONS_DIR, userId);
  try {
    await fs.mkdir(userDir, { recursive: true });
  } catch (error) {
    logger.error('Failed to create user discussions directory', { error, userId, path: userDir });
    throw new Error(`Failed to create discussions directory for user: ${userId}`);
  }
  return userDir;
}

/**
 * Get file paths for a discussion
 */
function getDiscussionPaths(userId: string, discussionId: string): { json: string; md: string } {
  const userDir = path.join(DISCUSSIONS_DIR, userId);
  return {
    json: path.join(userDir, `${discussionId}.json`),
    md: path.join(userDir, `${discussionId}.md`),
  };
}

/**
 * Create a new discussion file
 */
export async function createDiscussion(
  userId: string,
  topic: string,
  discussionId?: string
): Promise<{ id: string; jsonPath: string; mdPath: string }> {
  const id = discussionId || randomUUID();
  const now = Date.now();

  await ensureUserDirectory(userId);

  const data: DiscussionData = {
    id,
    topic,
    userId,
    // messages array removed - rounds are primary source of truth
    // messages field kept optional in type for backward compatibility with old data
    rounds: [], // Primary: round-based structure
    summaries: [], // Array of summaries
    questions: [], // All question sets
    currentRound: 0, // Current round number
    createdAt: now,
    updatedAt: now,
  };

  // Ensure all fields are initialized
  if (!data.rounds) data.rounds = [];
  if (!data.summaries) data.summaries = [];
  if (!data.questions) data.questions = [];
  if (data.currentRound === undefined) data.currentRound = 0;

  const paths = getDiscussionPaths(userId, id);

  try {
    const jsonContent = formatDiscussionJSON(data);
    const mdContent = formatDiscussionMarkdown(data);

    // Use atomic write with retry logic
    await retryFileOperation(
      () => writeDiscussionFilesAtomically(paths.json, paths.md, jsonContent, mdContent),
      { discussionId: id, userId, operation: 'createDiscussion' }
    );

    logger.info('Discussion files created', { discussionId: id, userId, topic });

    // Trigger backup asynchronously (don't block)
    if (BACKUP_CONFIG.ENABLED) {
      backupDiscussion(userId, id).catch((backupError) => {
        logger.warn('Failed to backup discussion after creation', {
          error: backupError instanceof Error ? backupError.message : String(backupError),
          discussionId: id,
          userId,
        });
      });
    }

    return { id, jsonPath: paths.json, mdPath: paths.md };
  } catch (error) {
    logger.error('Failed to create discussion files', { error, discussionId: id, userId });
    throw new Error(
      `Failed to create discussion files: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Read discussion data from JSON file
 */
export async function readDiscussion(
  discussionId: string,
  userId: string
): Promise<DiscussionData> {
  const paths = getDiscussionPaths(userId, discussionId);

  try {
    const jsonContent = await fs.readFile(paths.json, 'utf-8');
    const data = parseDiscussionJSON(jsonContent);

    // Verify user ownership
    if (data.userId !== userId) {
      throw new Error('Discussion does not belong to user');
    }

    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Discussion not found: ${discussionId}`);
    }
    logger.error('Failed to read discussion', { error, discussionId, userId });
    throw error;
  }
}

/**
 * Append a message to discussion files
 */
export async function appendMessageToDiscussion(
  discussionId: string,
  userId: string,
  message: ConversationMessage
): Promise<{ tokenCount: number }> {
  const data = await readDiscussion(discussionId, userId);

  // Add message
  if (!data.messages) {
    data.messages = [];
  }
  data.messages.push(message);
  data.updatedAt = Date.now();

  // Calculate token count
  const totalTokens = data.messages.reduce((sum, msg) => sum + countTokens(msg.content), 0);

  const paths = getDiscussionPaths(userId, discussionId);

  try {
    const jsonContent = formatDiscussionJSON(data);
    const mdContent = formatDiscussionMarkdown(data);

    // Use atomic write with retry logic
    await retryFileOperation(
      () => writeDiscussionFilesAtomically(paths.json, paths.md, jsonContent, mdContent),
      { discussionId, userId, operation: 'appendMessage' }
    );

    logger.debug('Message appended to discussion', {
      discussionId,
      userId,
      messageId: message.id,
      tokenCount: totalTokens,
    });
    return { tokenCount: totalTokens };
  } catch (error) {
    logger.error('Failed to append message to discussion', { error, discussionId, userId });
    throw error;
  }
}

/**
 * Update discussion with summary (legacy - kept for backward compatibility)
 */
export async function updateDiscussionWithSummary(
  discussionId: string,
  userId: string,
  summary: string
): Promise<void> {
  const data = await readDiscussion(discussionId, userId);

  data.summary = summary;
  data.summaryCreatedAt = Date.now();
  data.updatedAt = Date.now();

  const paths = getDiscussionPaths(userId, discussionId);

  try {
    const jsonContent = formatDiscussionJSON(data);
    const mdContent = formatDiscussionMarkdown(data);

    // Use atomic write to ensure both files are written successfully
    await retryFileOperation(
      () => writeDiscussionFilesAtomically(paths.json, paths.md, jsonContent, mdContent),
      { discussionId, userId, operation: 'updateDiscussionWithSummary' }
    );

    logger.info('Discussion updated with summary', { discussionId, userId });
  } catch (error) {
    logger.error('Failed to update discussion with summary', { error, discussionId, userId });
    throw error;
  }
}

/**
 * Add a round to discussion
 * Uses file locking to prevent concurrent modifications
 */
export async function addRoundToDiscussion(
  discussionId: string,
  userId: string,
  round: DiscussionRound
): Promise<void> {
  // Use file lock to prevent concurrent writes
  await withLock(discussionId, userId, async () => {
    const data = await readDiscussion(discussionId, userId);

    // Initialize arrays if they don't exist (for backward compatibility)
    if (!data.rounds) {
      data.rounds = [];
    }
    if (!data.questions) {
      data.questions = [];
    }

    data.rounds.push(round);
    data.currentRound = round.roundNumber;
    data.updatedAt = Date.now();

    // Note: We no longer populate the messages array from rounds.
    // Rounds are the source of truth. Messages array is generated on-demand
    // for backward compatibility in conversation-context.ts if needed.

    const paths = getDiscussionPaths(userId, discussionId);

    try {
      const jsonContent = formatDiscussionJSON(data);
      const mdContent = formatDiscussionMarkdown(data);

      // Use atomic write with retry logic
      await retryFileOperation(
        () => writeDiscussionFilesAtomically(paths.json, paths.md, jsonContent, mdContent),
        { discussionId, userId, operation: 'addRound' }
      );

      logger.info('Round added to discussion', {
        discussionId,
        userId,
        roundNumber: round.roundNumber,
      });
    } catch (error) {
      logger.error('Failed to add round to discussion', { error, discussionId, userId });
      throw error;
    }
  });
}

/**
 * Add summary entry to discussion
 * Uses file locking to prevent concurrent modifications
 */
export async function addSummaryToDiscussion(
  discussionId: string,
  userId: string,
  summaryEntry: SummaryEntry
): Promise<void> {
  // Use file lock to prevent concurrent writes
  await withLock(discussionId, userId, async () => {
    const data = await readDiscussion(discussionId, userId);

    // Initialize arrays if they don't exist
    if (!data.summaries) {
      data.summaries = [];
    }

    data.summaries.push(summaryEntry);
    data.currentSummary = summaryEntry;

    // Also update legacy summary fields for backward compatibility
    data.summary = summaryEntry.summary;
    data.summaryCreatedAt = summaryEntry.createdAt;

    data.updatedAt = Date.now();

    const paths = getDiscussionPaths(userId, discussionId);

    try {
      const jsonContent = formatDiscussionJSON(data);
      const mdContent = formatDiscussionMarkdown(data);

      // Use atomic write with retry logic
      await retryFileOperation(
        () => writeDiscussionFilesAtomically(paths.json, paths.md, jsonContent, mdContent),
        { discussionId, userId, operation: 'addSummary' }
      );

      logger.info('Summary added to discussion', {
        discussionId,
        userId,
        roundNumber: summaryEntry.roundNumber,
        tokenReduction: summaryEntry.tokenCountBefore - summaryEntry.tokenCountAfter,
      });
    } catch (error) {
      logger.error('Failed to add summary to discussion', { error, discussionId, userId });
      throw error;
    }
  });
}

/**
 * Add question set to discussion
 * Uses file locking to prevent concurrent modifications
 */
export async function addQuestionSetToDiscussion(
  discussionId: string,
  userId: string,
  questionSet: QuestionSet
): Promise<void> {
  // Use file lock to prevent concurrent writes
  await withLock(discussionId, userId, async () => {
    const data = await readDiscussion(discussionId, userId);

    // Initialize arrays if they don't exist
    if (!data.questions) {
      data.questions = [];
    }
    if (!data.rounds) {
      data.rounds = [];
    }

    data.questions.push(questionSet);

    // Also add question set to the corresponding round
    const round = data.rounds.find((r) => r.roundNumber === questionSet.roundNumber);
    if (round) {
      round.questions = questionSet;
    }

    data.updatedAt = Date.now();

    const paths = getDiscussionPaths(userId, discussionId);

    try {
      const jsonContent = formatDiscussionJSON(data);
      const mdContent = formatDiscussionMarkdown(data);

      // Use atomic write to ensure both files are written successfully
      await retryFileOperation(
        () => writeDiscussionFilesAtomically(paths.json, paths.md, jsonContent, mdContent),
        { discussionId, userId, operation: 'addQuestionSet' }
      );

      logger.info('Question set added to discussion', {
        discussionId,
        userId,
        roundNumber: questionSet.roundNumber,
        questionCount: questionSet.questions.length,
      });
    } catch (error) {
      logger.error('Failed to add question set to discussion', { error, discussionId, userId });
      throw error;
    }
  });
}

/**
 * Update user answers for a round's questions
 * Uses file locking and ensures atomic updates
 */
export async function updateRoundAnswers(
  discussionId: string,
  userId: string,
  roundNumber: number,
  answers: Record<string, string[]> // questionId -> selected option IDs
): Promise<void> {
  // Use file lock to prevent concurrent modifications
  await withLock(discussionId, userId, async () => {
    const data = await readDiscussion(discussionId, userId);

    if (!data.rounds) {
      throw new Error('No rounds found in discussion');
    }

    const round = data.rounds.find((r) => r.roundNumber === roundNumber);
    if (!round || !round.questions) {
      throw new Error(`Round ${roundNumber} or its questions not found`);
    }

    // Validate data consistency before writing
    const questionIds = round.questions.questions.map((q) => q.id);
    const answerQuestionIds = Object.keys(answers);
    const invalidAnswers = answerQuestionIds.filter((id) => !questionIds.includes(id));
    if (invalidAnswers.length > 0) {
      throw new Error(`Invalid question IDs in answers: ${invalidAnswers.join(', ')}`);
    }

    // Update answers in round
    round.userAnswers = Object.values(answers).flat();

    // Update answers in question set
    round.questions.questions.forEach((question) => {
      question.userAnswers = answers[question.id] || [];
    });

    // Also update in questions array
    const questionSet = data.questions?.find((qs) => qs.roundNumber === roundNumber);
    if (questionSet) {
      questionSet.questions.forEach((question) => {
        question.userAnswers = answers[question.id] || [];
      });
    }

    data.updatedAt = Date.now();

    const paths = getDiscussionPaths(userId, discussionId);

    try {
      const jsonContent = formatDiscussionJSON(data);
      const mdContent = formatDiscussionMarkdown(data);

      // Use atomic write to ensure both files are written successfully
      await retryFileOperation(
        () => writeDiscussionFilesAtomically(paths.json, paths.md, jsonContent, mdContent),
        { discussionId, userId, operation: 'updateRoundAnswers' }
      );

      logger.info('Round answers updated', {
        discussionId,
        userId,
        roundNumber,
        answerCount: Object.keys(answers).length,
      });
    } catch (error) {
      logger.error('Failed to update round answers', { error, discussionId, userId });
      throw error;
    }
  });
}

/**
 * Get all discussion IDs for a user
 */
export async function getUserDiscussionIds(userId: string): Promise<string[]> {
  const userDir = path.join(DISCUSSIONS_DIR, userId);

  try {
    const files = await fs.readdir(userDir);
    const discussionIds = files
      .filter((file) => file.endsWith('.json'))
      .map((file) => path.basename(file, '.json'))
      .filter((id) => id.length > 0);

    return discussionIds;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []; // User directory doesn't exist yet
    }
    logger.error('Failed to list user discussions', { error, userId });
    throw error;
  }
}

/**
 * Get discussion file paths (relative to discussions directory)
 */
export function getDiscussionFilePaths(
  userId: string,
  discussionId: string
): { json: string; md: string } {
  return {
    json: path.join(userId, `${discussionId}.json`),
    md: path.join(userId, `${discussionId}.md`),
  };
}
