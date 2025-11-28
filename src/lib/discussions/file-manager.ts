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
import {
  sortRoundsByRoundNumber,
  validateRoundNumberSequence,
  validateRoundsSorted,
  validateNewRoundNumber,
  filterIncompleteRounds,
  calculateTurnNumber,
} from './round-utils';
import { FILE_STORAGE_CONFIG } from '@/lib/config';

const DISCUSSIONS_DIR =
  FILE_STORAGE_CONFIG.DISCUSSIONS_DIR.startsWith('/') || FILE_STORAGE_CONFIG.DISCUSSIONS_DIR.startsWith('data/')
    ? FILE_STORAGE_CONFIG.DISCUSSIONS_DIR
    : path.join(process.cwd(), FILE_STORAGE_CONFIG.DISCUSSIONS_DIR);

/**
 * Retry configuration for file operations
 */
const FILE_OPERATION_RETRY_CONFIG = {
  MAX_ATTEMPTS: FILE_STORAGE_CONFIG.FILE_OPERATION_MAX_RETRIES,
  INITIAL_DELAY_MS: FILE_STORAGE_CONFIG.FILE_OPERATION_RETRY_DELAY_MS,
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

  // Default: treat as permanent (fail fast) - safer than retrying unknown errors
  // Log warning for monitoring to improve categorization over time
  logger.warn('Uncategorized error, treating as permanent (fail fast)', {
    error: errorMessage,
    code: errorCode,
    note: 'Please add specific pattern to categorize this error type',
  });
  return { isTransient: false, category: 'uncategorized' };
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

  // Track all temp files created during this operation
  const tempFiles = new Set<string>();
  tempFiles.add(jsonTempPath);
  tempFiles.add(mdTempPath);

  let originalError: Error | unknown;
  const cleanupErrors: Array<{ file: string; error: Error | unknown }> = [];

  // Helper function to cleanup tracked temp files
  const cleanupTempFiles = async (): Promise<void> => {
    const cleanupPromises = Array.from(tempFiles).map(async (tempFile) => {
      try {
        await fs.access(tempFile); // Check if file exists
        await fs.unlink(tempFile);
        tempFiles.delete(tempFile); // Remove from tracking after successful cleanup
      } catch (cleanupError) {
        // File doesn't exist or cleanup failed - log but don't throw
        if ((cleanupError as { code?: string }).code !== 'ENOENT') {
          cleanupErrors.push({ file: tempFile, error: cleanupError });
        }
      }
    });

    await Promise.allSettled(cleanupPromises);

    // Log cleanup errors if any occurred (but don't throw - original error is more important)
    if (cleanupErrors.length > 0) {
      logger.warn('Failed to cleanup some temp files after error', {
        cleanupErrors: cleanupErrors.map((e) => ({
          file: e.file,
          error: e.error instanceof Error ? e.error.message : String(e.error),
        })),
        originalError: originalError instanceof Error ? originalError.message : String(originalError),
        tempFilesRemaining: Array.from(tempFiles),
      });
    }

    // If any temp files remain, they will be cleaned up by the periodic temp-cleanup job
    if (tempFiles.size > 0) {
      logger.debug('Some temp files remain after cleanup attempt (will be cleaned by periodic job)', {
        remainingFiles: Array.from(tempFiles),
      });
    }
  };

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

    // After successful rename, remove temp files from tracking (they no longer exist as temp files)
    tempFiles.delete(jsonTempPath);
    tempFiles.delete(mdTempPath);

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

    // Always attempt to cleanup temp files, even if original error occurred
    // This ensures we don't leave orphaned temp files
    await cleanupTempFiles();

    // Throw original error after cleanup attempt
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
 * Includes explicit path traversal validation for security
 */
function getDiscussionPaths(userId: string, discussionId: string): { json: string; md: string } {
  // Validate userId and discussionId don't contain path traversal sequences
  const pathTraversalPatterns = ['..', '/', '\\'];
  const hasPathTraversal = (value: string): boolean => {
    return pathTraversalPatterns.some((pattern) => value.includes(pattern));
  };

  if (hasPathTraversal(userId)) {
    logger.error('Path traversal attempt detected in userId', { userId });
    throw new Error('Invalid userId: path traversal sequences are not allowed');
  }

  if (hasPathTraversal(discussionId)) {
    logger.error('Path traversal attempt detected in discussionId', { discussionId });
    throw new Error('Invalid discussionId: path traversal sequences are not allowed');
  }

  // Build paths using path.join for proper normalization
  const userDir = path.join(DISCUSSIONS_DIR, userId);
  const jsonPath = path.join(userDir, `${discussionId}.json`);
  const mdPath = path.join(userDir, `${discussionId}.md`);

  // Verify resolved paths stay within DISCUSSIONS_DIR (defense in depth)
  const resolvedJsonPath = path.resolve(jsonPath);
  const resolvedMdPath = path.resolve(mdPath);
  const resolvedDiscussionsDir = path.resolve(DISCUSSIONS_DIR);

  if (!resolvedJsonPath.startsWith(resolvedDiscussionsDir) || !resolvedMdPath.startsWith(resolvedDiscussionsDir)) {
    logger.error('Path traversal detected: resolved path outside DISCUSSIONS_DIR', {
      userId,
      discussionId,
      resolvedJsonPath,
      resolvedMdPath,
      resolvedDiscussionsDir,
    });
    throw new Error('Invalid path: resolved path must stay within discussions directory');
  }

  return {
    json: jsonPath,
    md: mdPath,
  };
}

/**
 * Create a new discussion file
 *
 * Discussion ID Uniqueness:
 * - Uses randomUUID() which is cryptographically secure and generates unique IDs
 * - Database constraint: PRIMARY KEY on id (enforces uniqueness at DB level)
 * - File system structure: discussions stored per user directory (userId/discussionId.json)
 * - User ownership verified in readDiscussion() - ensures user-discussion relationship
 */
export async function createDiscussion(
  userId: string,
  topic: string,
  discussionId?: string
): Promise<{ id: string; jsonPath: string; mdPath: string }> {
  // Generate unique discussion ID using cryptographically secure randomUUID
  // Database PRIMARY KEY constraint ensures uniqueness at database level
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
/**
 * Read discussion from JSON file
 * CRITICAL: This loads ALL rounds from the JSON file - the complete discussion history
 * The JSON file is the source of truth for LLM context and contains all previous rounds
 * The MD file is for user viewing/deletion in the browser
 */
export async function readDiscussion(
  discussionId: string,
  userId: string
): Promise<DiscussionData> {
  const paths = getDiscussionPaths(userId, discussionId);

  try {
    // CRITICAL: Read ALL rounds from JSON file (source of truth for LLM context)
    const jsonContent = await fs.readFile(paths.json, 'utf-8');
    const data = parseDiscussionJSON(jsonContent);

    // Verify user ownership
    if (data.userId !== userId) {
      throw new Error('Discussion does not belong to user');
    }

    // CRITICAL: Sort rounds by roundNumber after reading to ensure consistent order
    // JSON.parse should preserve array order, but we explicitly sort to be safe
    // ALL rounds from JSON file are loaded - this is the complete discussion history
    if (data.rounds && data.rounds.length > 0) {
      // Validate rounds are sorted (log warning if not, but don't fail)
      if (!validateRoundsSorted(data.rounds)) {
        logger.warn('Rounds not sorted by roundNumber after reading, sorting now', {
          discussionId,
          userId,
          roundsCount: data.rounds.length,
        });
      }

      // Sort rounds explicitly
      // CRITICAL: ALL rounds from JSON file are preserved - this is the complete history
      data.rounds = sortRoundsByRoundNumber(data.rounds);

      logger.debug('📚 Loaded all rounds from JSON file', {
        discussionId,
        userId,
        totalRounds: data.rounds.length,
        roundNumbers: data.rounds.map((r) => r.roundNumber),
        note: 'JSON file contains complete discussion history - all rounds available for LLM context',
      });

      // Validate round number sequence integrity
      const sequenceValidation = validateRoundNumberSequence(data.rounds);
      if (!sequenceValidation.isValid) {
        logger.error('Round number sequence validation failed', {
          discussionId,
          userId,
          errors: sequenceValidation.errors,
        });
        // Don't throw - log error but continue (may be recoverable)
      }
    }

    return data;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
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

    // CRITICAL: Validate round number matches expected value before adding
    const roundValidation = validateNewRoundNumber(data.rounds, round.roundNumber);
    if (!roundValidation.isValid) {
      logger.error('Invalid round number when adding round', {
        discussionId,
        userId,
        roundNumber: round.roundNumber,
        expectedRoundNumber: data.rounds.length + 1,
        error: roundValidation.error,
      });
      throw new Error(roundValidation.error || 'Invalid round number');
    }

    // CRITICAL: Validate turn numbers match expected values before saving
    // This is a safety check to ensure data integrity even if corrupted data somehow
    // gets through the handlers validation
    const expectedAnalyzerTurn = calculateTurnNumber(round.roundNumber, 'Analyzer AI');
    const expectedSolverTurn = calculateTurnNumber(round.roundNumber, 'Solver AI');
    const expectedModeratorTurn = calculateTurnNumber(round.roundNumber, 'Moderator AI');

    if (round.analyzerResponse.turn !== expectedAnalyzerTurn) {
      logger.error('🚨 CRITICAL: Analyzer turn number mismatch in addRoundToDiscussion', {
        discussionId,
        userId,
        roundNumber: round.roundNumber,
        expectedTurn: expectedAnalyzerTurn,
        actualTurn: round.analyzerResponse.turn,
      });
      throw new Error(`Analyzer turn number mismatch: expected ${expectedAnalyzerTurn}, got ${round.analyzerResponse.turn}`);
    }

    if (round.solverResponse.turn !== expectedSolverTurn) {
      logger.error('🚨 CRITICAL: Solver turn number mismatch in addRoundToDiscussion', {
        discussionId,
        userId,
        roundNumber: round.roundNumber,
        expectedTurn: expectedSolverTurn,
        actualTurn: round.solverResponse.turn,
      });
      throw new Error(`Solver turn number mismatch: expected ${expectedSolverTurn}, got ${round.solverResponse.turn}`);
    }

    if (round.moderatorResponse.turn !== expectedModeratorTurn) {
      logger.error('🚨 CRITICAL: Moderator turn number mismatch in addRoundToDiscussion', {
        discussionId,
        userId,
        roundNumber: round.roundNumber,
        expectedTurn: expectedModeratorTurn,
        actualTurn: round.moderatorResponse.turn,
      });
      throw new Error(`Moderator turn number mismatch: expected ${expectedModeratorTurn}, got ${round.moderatorResponse.turn}`);
    }

    // Validate personas match expected values
    if (round.analyzerResponse.persona !== 'Analyzer AI') {
      logger.error('🚨 CRITICAL: Analyzer persona mismatch in addRoundToDiscussion', {
        discussionId,
        userId,
        roundNumber: round.roundNumber,
        expectedPersona: 'Analyzer AI',
        actualPersona: round.analyzerResponse.persona,
      });
      throw new Error(`Analyzer persona mismatch: expected 'Analyzer AI', got '${round.analyzerResponse.persona}'`);
    }

    if (round.solverResponse.persona !== 'Solver AI') {
      logger.error('🚨 CRITICAL: Solver persona mismatch in addRoundToDiscussion', {
        discussionId,
        userId,
        roundNumber: round.roundNumber,
        expectedPersona: 'Solver AI',
        actualPersona: round.solverResponse.persona,
      });
      throw new Error(`Solver persona mismatch: expected 'Solver AI', got '${round.solverResponse.persona}'`);
    }

    if (round.moderatorResponse.persona !== 'Moderator AI') {
      logger.error('🚨 CRITICAL: Moderator persona mismatch in addRoundToDiscussion', {
        discussionId,
        userId,
        roundNumber: round.roundNumber,
        expectedPersona: 'Moderator AI',
        actualPersona: round.moderatorResponse.persona,
      });
      throw new Error(`Moderator persona mismatch: expected 'Moderator AI', got '${round.moderatorResponse.persona}'`);
    }

    logger.debug('Round validation passed before saving', {
      discussionId,
      userId,
      roundNumber: round.roundNumber,
      analyzerTurn: round.analyzerResponse.turn,
      solverTurn: round.solverResponse.turn,
      moderatorTurn: round.moderatorResponse.turn,
    });

    // CRITICAL: Add round to rounds array - ALL rounds are preserved in JSON file
    // The JSON file contains the complete discussion history - all rounds are saved here
    // This ensures LLMs have access to full context of all previous rounds
    data.rounds.push(round);
    // CRITICAL: Sort rounds after adding to maintain order
    data.rounds = sortRoundsByRoundNumber(data.rounds);
    data.currentRound = round.roundNumber;
    data.updatedAt = Date.now();

    // Note: We no longer populate the messages array from rounds.
    // Rounds are the source of truth. Messages array is generated on-demand
    // for backward compatibility in discussion-context.ts if needed.

    const paths = getDiscussionPaths(userId, discussionId);

    try {
      // CRITICAL: Save ALL rounds to JSON file (for LLM context) and MD file (for user viewing)
      // formatDiscussionJSON saves the entire DiscussionData object, including ALL rounds
      // This ensures the complete discussion history is available for LLM context
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
    if ((error as { code?: string }).code === 'ENOENT') {
      return []; // User directory doesn't exist yet
    }
    logger.error('Failed to list user discussions', { error, userId });
    throw error;
  }
}

/**
 * Get discussion file paths (relative to discussions directory)
 */
/**
 * Delete discussion files (JSON and Markdown)
 * Uses file locking to prevent race conditions
 * @param userId - User ID
 * @param discussionId - Discussion ID
 * @throws Error if files cannot be deleted
 */
export async function deleteDiscussionFiles(userId: string, discussionId: string): Promise<void> {
  const paths = getDiscussionPaths(userId, discussionId);

  return withLock(discussionId, userId, async () => {
    try {
      // Delete both files, ignore errors if files don't exist
      await Promise.allSettled([
        fs.unlink(paths.json).catch((error) => {
          if ((error as { code?: string }).code !== 'ENOENT') {
            throw error;
          }
        }),
        fs.unlink(paths.md).catch((error) => {
          if ((error as { code?: string }).code !== 'ENOENT') {
            throw error;
          }
        }),
      ]);

      logger.info('Discussion files deleted', {
        discussionId,
        userId,
        jsonPath: paths.json,
        mdPath: paths.md,
      });
    } catch (error) {
      logger.error('Error deleting discussion files', {
        discussionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
}

export function getDiscussionFilePaths(
  userId: string,
  discussionId: string
): { json: string; md: string } {
  return {
    json: path.join(userId, `${discussionId}.json`),
    md: path.join(userId, `${discussionId}.md`),
  };
}

/**
 * Clean up incomplete rounds from discussion storage
 * Removes rounds that have some responses but not all three
 * This prevents incomplete rounds from contaminating context
 *
 * @param discussionId - Discussion ID
 * @param userId - User ID for ownership verification
 * @returns Number of incomplete rounds removed
 */
export async function cleanupIncompleteRounds(
  discussionId: string,
  userId: string
): Promise<number> {
  return withLock(discussionId, userId, async () => {
    const data = await readDiscussion(discussionId, userId);

    if (!data.rounds || data.rounds.length === 0) {
      return 0; // No rounds to clean up
    }

    // Find incomplete rounds
    const incompleteRounds = filterIncompleteRounds(data.rounds);
    if (incompleteRounds.length === 0) {
      return 0; // No incomplete rounds to remove
    }

    // Log incomplete rounds before removal
    logger.info('Cleaning up incomplete rounds', {
      discussionId,
      userId,
      totalRounds: data.rounds.length,
      incompleteRoundsCount: incompleteRounds.length,
      incompleteRounds: incompleteRounds.map((r) => ({
        roundNumber: r.roundNumber,
        hasAnalyzer: !!r.analyzerResponse?.content?.trim(),
        hasSolver: !!r.solverResponse?.content?.trim(),
        hasModerator: !!r.moderatorResponse?.content?.trim(),
      })),
    });

    // Remove incomplete rounds
    const incompleteRoundNumbers = new Set(incompleteRounds.map((r) => r.roundNumber));
    const cleanedRounds = data.rounds.filter((r) => !incompleteRoundNumbers.has(r.roundNumber));

    // Update data
    data.rounds = cleanedRounds;
    data.updatedAt = Date.now();

    // Recalculate currentRound to be the highest complete round number
    if (cleanedRounds.length > 0) {
      const sortedRounds = sortRoundsByRoundNumber(cleanedRounds);
      data.currentRound = sortedRounds[sortedRounds.length - 1].roundNumber;
    } else {
      data.currentRound = 0;
    }

    const paths = getDiscussionPaths(userId, discussionId);

    try {
      const jsonContent = formatDiscussionJSON(data);
      const mdContent = formatDiscussionMarkdown(data);

      // Use atomic write with retry logic
      await retryFileOperation(
        () => writeDiscussionFilesAtomically(paths.json, paths.md, jsonContent, mdContent),
        { discussionId, userId, operation: 'cleanupIncompleteRounds' }
      );

      logger.info('Incomplete rounds cleaned up successfully', {
        discussionId,
        userId,
        removedCount: incompleteRounds.length,
        remainingRounds: cleanedRounds.length,
        newCurrentRound: data.currentRound,
      });

      return incompleteRounds.length;
    } catch (error) {
      logger.error('Failed to clean up incomplete rounds', { error, discussionId, userId });
      throw error;
    }
  });
}

/**
 * Delete all discussion files for a user
 * @param userId - User ID whose discussion files should be deleted
 * @returns Number of files deleted
 */
export async function deleteAllUserDiscussionFiles(userId: string): Promise<number> {
  const userDir = path.join(DISCUSSIONS_DIR, userId);
  let deletedCount = 0;

  try {
    // Check if user directory exists
    try {
      await fs.access(userDir);
    } catch {
      // Directory doesn't exist, nothing to delete
      logger.info('User discussion directory does not exist', { userId, userDir });
      return 0;
    }

    // Read all files in user directory
    const files = await fs.readdir(userDir);

    // Delete all .json and .md files
    const deletePromises = files
      .filter((file) => file.endsWith('.json') || file.endsWith('.md'))
      .map(async (file) => {
        const filePath = path.join(userDir, file);
        try {
          await fs.unlink(filePath);
          deletedCount++;
          logger.debug('Deleted discussion file', { userId, file, filePath });
        } catch (error) {
          logger.error('Error deleting discussion file', {
            userId,
            file,
            filePath,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with other files even if one fails
        }
      });

    await Promise.allSettled(deletePromises);

    // Try to remove the user directory if it's empty
    try {
      const remainingFiles = await fs.readdir(userDir);
      if (remainingFiles.length === 0) {
        await fs.rmdir(userDir);
        logger.debug('Removed empty user discussion directory', { userId, userDir });
      }
    } catch (error) {
      // Ignore errors removing directory (might not be empty or might have subdirectories)
      logger.debug('Could not remove user discussion directory', {
        userId,
        userDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('All discussion files deleted for user', {
      userId,
      deletedCount,
      userDir,
    });

    return deletedCount;
  } catch (error) {
    logger.error('Error deleting all user discussion files', {
      userId,
      userDir,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
