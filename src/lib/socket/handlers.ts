/**
 * Socket.IO Handlers for Discussion System
 *
 * All events use `discussionId` field name in payloads consistently.
 */

import { Server, Socket } from 'socket.io';
// Note: addMessage() removed - file storage is primary, database storage was redundant
import {
  createDiscussion,
  getDiscussion,
  updateDiscussion,
  syncTokenCountFromFile,
} from '@/lib/db/discussions';
import {
  createDiscussion as createDiscussionFiles,
  addRoundToDiscussion,
  addQuestionSetToDiscussion,
  updateRoundAnswers,
  readDiscussion,
} from '@/lib/discussions/file-manager';
import { loadDiscussionContext } from '@/lib/discussion-context';
import { formatLLMPrompt } from '@/lib/discussion-context';
import { getProviderWithFallback, aiPersonas, checkLLMProviderAvailability } from '@/lib/llm';
import {
  filterCompleteRounds,
  calculateTurnNumber,
  isRoundIncomplete,
  filterRoundsForPersona,
} from '@/lib/discussions/round-utils';
import {
  EXECUTION_ORDER,
  validateExecutionOrder,
  validatePersonaCanExecute,
  logExecutionOrderValidation,
} from '@/lib/discussions/execution-order';
import { validatePersonaOrder } from '@/lib/discussions/round-validator';
import { validateRoundNumberSequence, validateNewRoundNumber } from '@/lib/discussions/round-utils';
import type { LLMProvider } from '@/lib/llm/types';
import { summarizeRounds } from '@/lib/llm/summarizer';
import { generateQuestions } from '@/lib/llm/question-generator';
// Moderator summary generation removed - Moderator AI now participates in discussion
import { isResolved } from '@/lib/llm/resolver';
import {
  dialogueRequestSchema,
  validateFile,
  BASE64_SIZE_LIMIT,
  validateBase64Format,
  sanitizeFileName,
} from '@/lib/validation';
import { verifyFileFromBase64 } from '@/lib/file-verification';
import { checkRateLimit, checkStartDialogueRateLimit } from '@/lib/rate-limit';
import { getUserRateLimitTier } from '@/lib/rate-limit-tier';
import { logger } from '@/lib/logger';
import { SERVER_CONFIG } from '@/lib/config';
import { authenticateSocket, getSocketUserId, isSocketAuthenticated } from '@/lib/socket/auth-middleware';
import { shouldEmitError, emitErrorToRoomWithDeduplication } from '@/lib/socket/error-deduplication';
import {
  checkConnectionRateLimit,
  checkConnectionCountLimit,
  registerConnection,
  unregisterConnection,
  updateConnectionActivity,
  checkMessageRateLimit,
  checkPayloadSize,
} from '@/lib/socket/connection-manager';
import {
  verifyDiscussionOwnership,
  createAuthorizationError,
} from '@/lib/socket/authorization';

/**
 * Helper function to synchronize file and database updates
 * File storage is the source of truth. Database updates are for metadata only.
 * If database update fails, it's logged but doesn't fail the operation.
 *
 * @param fileOperation - Async function that performs file operations
 * @param dbUpdate - Function that performs database update, receives file result as parameter
 * @param context - Context information for logging (discussionId, userId, etc.)
 */
async function syncFileAndDatabase<T>(
  fileOperation: () => Promise<T>,
  dbUpdate: (fileResult: T) => void,
  context: { discussionId?: string; userId?: string; operation: string }
): Promise<T> {
  // Perform file operation first (source of truth)
  const fileResult = await fileOperation();

  // Then update database (metadata only)
  // Note: dbUpdate receives fileResult in case it needs values from the file operation
  try {
    dbUpdate(fileResult);
  } catch (dbError) {
    // Database update failed, but files are already updated
    // Log error for manual fix - file storage is source of truth
    logger.error('Database update failed after file operation', {
      error: dbError instanceof Error ? dbError.message : String(dbError),
      ...context,
      note: 'File storage is source of truth. Database may be out of sync and may need manual repair.',
    });
    // Don't throw - file operation succeeded, which is what matters
  }

  return fileResult;
}

import { checkDatabaseHealth } from '@/lib/db';
import { ErrorCode, createErrorFromCode } from '@/lib/errors';
import type {
  StartDialogueEvent,
  DiscussionRound,
  SubmitAnswersEvent,
  ProceedDialogueEvent,
  GenerateQuestionsEvent,
} from '@/types';
import type { LLMMessage } from '@/lib/llm/types';
import type { FileData } from '@/lib/validation';

import { DIALOGUE_CONFIG } from '@/lib/config';

const MAX_TURNS = DIALOGUE_CONFIG.MAX_TURNS;

/**
 * Helper function to emit errors with deduplication
 * @param socket - Socket instance
 * @param error - Error object, error code string, or AppError object
 * @param discussionId - Optional discussion ID
 * @param operation - Operation name
 */
function emitErrorWithDeduplication(
  socket: Socket,
  error: { code: ErrorCode | string; message: string; discussionId?: string } | string | { message: string; code: string; discussionId?: string },
  discussionId?: string,
  operation?: string
): void {
  // Extract error code and message from various input formats
  let errorCode: ErrorCode | string;
  let errorMessage: string;
  let errorDiscussionId: string | undefined;

  if (typeof error === 'string') {
    errorCode = error;
    errorMessage = error;
    errorDiscussionId = discussionId;
  } else if ('code' in error && 'message' in error) {
    errorCode = error.code;
    errorMessage = error.message;
    errorDiscussionId = error.discussionId ?? discussionId;
  } else {
    // Fallback for unexpected formats
    errorCode = ErrorCode.UNKNOWN_ERROR;
    errorMessage = 'An unknown error occurred';
    errorDiscussionId = discussionId;
  }

  // Log error before deduplication check
  logger.error('Socket error occurred', {
    error: errorMessage,
    errorCode,
    discussionId: errorDiscussionId,
    operation: operation || 'unknown',
    socketId: socket.id,
  });

  // Check if error should be emitted (deduplication)
  if (shouldEmitError(errorCode, errorDiscussionId, operation)) {
    socket.emit('error', {
      code: errorCode,
      message: errorMessage,
      discussionId: errorDiscussionId,
    });
  } else {
    logger.debug('Error deduplicated, not emitting', {
      code: errorCode,
      discussionId: errorDiscussionId,
      operation,
    });
  }
}

/**
 * Extract client IP address from socket connection
 * Handles proxy scenarios (x-forwarded-for header)
 * @param socket - Socket.IO socket instance
 * @returns IP address string or 'unknown' if cannot be determined
 */
function extractClientIP(socket: Socket): string {
  // Try x-forwarded-for header first (for proxy scenarios)
  const forwardedFor = socket.request.headers['x-forwarded-for'];
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one
    const ips = typeof forwardedFor === 'string' ? forwardedFor.split(',') : [forwardedFor[0]];
    const clientIp = ips[0]?.trim();
    if (clientIp) {
      return clientIp;
    }
  }

  // Fall back to socket handshake address
  const address = socket.handshake.address;
  if (address) {
    // Remove IPv6 prefix if present
    return address.replace(/^::ffff:/, '');
  }

  // Last resort fallback
  return 'unknown';
}

export function setupSocketHandlers(io: Server) {
  io.on('connection', async (socket: Socket) => {
    // Extract IP for connection management
    const clientIp = extractClientIP(socket);

    // Check connection rate limit (max connections per minute per IP)
    const rateLimitExceeded = await checkConnectionRateLimit(clientIp);
    if (rateLimitExceeded) {
      logger.warn('Connection rate limit exceeded', { socketId: socket.id, ip: clientIp });
      emitErrorWithDeduplication(
        socket,
        {
          code: ErrorCode.RATE_LIMIT_EXCEEDED,
          message: 'Too many connection attempts. Please wait a moment before trying again.',
        },
        undefined,
        'connection'
      );
      socket.disconnect(true);
      return;
    }

    // Check connection count limit (max concurrent connections per IP)
    const { exceeded: countExceeded, count } = await checkConnectionCountLimit(clientIp);
    if (countExceeded) {
      logger.warn('Connection count limit exceeded', {
        socketId: socket.id,
        ip: clientIp,
        count,
      });
      emitErrorWithDeduplication(
        socket,
        {
          code: ErrorCode.CONNECTION_LIMIT_EXCEEDED,
          message: 'Maximum number of concurrent connections exceeded. Please close other connections and try again.',
        },
        undefined,
        'connection'
      );
      socket.disconnect(true);
      return;
    }

    // Authenticate socket connection
    const authenticated = await authenticateSocket(socket);
    if (!authenticated) {
      logger.warn('Socket authentication failed, disconnecting', { socketId: socket.id });
      socket.disconnect(true);
      return;
    }

    // Register connection
    await registerConnection(socket);

    logger.info('Client connected', {
      socketId: socket.id,
      userId: getSocketUserId(socket),
      isAuthenticated: isSocketAuthenticated(socket),
      ip: clientIp,
    });

    // Helper function to check message rate and payload size before processing
    const checkMessageLimits = (eventData: unknown): boolean => {
      // Update connection activity
      updateConnectionActivity(socket);

      // Check payload size
      if (checkPayloadSize(eventData)) {
        logger.warn('Payload size exceeded', { socketId: socket.id });
        emitErrorWithDeduplication(socket, {
          code: ErrorCode.PAYLOAD_TOO_LARGE,
          message: 'Message payload is too large. Maximum size is 1MB.',
        }, undefined, 'checkMessageLimits');
        return false;
      }

      // Check message rate limit
      if (checkMessageRateLimit(socket)) {
        logger.warn('Message rate limit exceeded', { socketId: socket.id });
        emitErrorWithDeduplication(socket, {
          code: ErrorCode.RATE_LIMIT_EXCEEDED,
          message: 'Too many messages. Please slow down.',
        }, undefined, 'checkMessageLimits');
        return false;
      }

      return true;
    };

    // Start a new dialogue
    socket.on('start-dialogue', async (data: StartDialogueEvent, ack?: (response: { error?: string; data?: unknown }) => void) => {
      if (!checkMessageLimits(data)) {
        if (ack) ack({ error: 'Message limits exceeded' });
        return;
      }
      logger.info('Received start-dialogue event', {
        socketId: socket.id,
        topicLength: data.topic?.length,
        fileCount: data.files?.length || 0,
      });
      try {
        // Check operation-specific rate limit
        const clientIpStart = extractClientIP(socket);
        const rateLimitCheck = await checkStartDialogueRateLimit(clientIpStart);
        if (rateLimitCheck.exceeded) {
          const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED, {
            operation: 'start-dialogue',
            remaining: rateLimitCheck.remaining,
            reset: rateLimitCheck.reset,
          });
          emitErrorWithDeduplication(socket, error, undefined, 'start-dialogue');
          if (ack) ack({ error: error.message });
          return;
        }
        // Validate files BEFORE rate limiting (don't count invalid requests toward rate limit)
        if (data.files && data.files.length > 0) {
          for (const file of data.files) {
            if (!file.name || !file.type || file.size === undefined) {
              const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'file' });
              emitErrorWithDeduplication(socket, error, undefined, 'start-dialogue');
              if (ack) ack({ error: 'Invalid file data provided' });
              return;
            }

            // Sanitize file name to prevent path traversal attacks
            file.name = sanitizeFileName(file.name);

            // Validate file using centralized validation
            const fileValidation = validateFile(file, false);
            if (!fileValidation.isValid) {
              const error = createErrorFromCode(ErrorCode.INVALID_FILE_SIZE, {
                fileName: file.name,
                size: file.size,
              });
              emitErrorWithDeduplication(socket, {
                code: error.code,
                message: fileValidation.error || `File "${file.name}" validation failed.`,
              }, undefined, 'start-dialogue');
              return;
            }

            // Validate base64 size and format if base64 is present
            if (file.base64) {
              const base64Size = file.base64.length;
              if (base64Size > BASE64_SIZE_LIMIT) {
                const error = createErrorFromCode(ErrorCode.INVALID_FILE_SIZE, {
                  fileName: file.name,
                  size: base64Size,
                });
                emitErrorWithDeduplication(socket, {
                  code: error.code,
                  message: `File "${file.name}" base64 encoding exceeds the ${BASE64_SIZE_LIMIT / (1024 * 1024)}MB limit. Please use a smaller file.`,
                }, undefined, 'start-dialogue');
                return;
              }

              // Validate base64 format
              const base64FormatValidation = validateBase64Format(file.base64);
              if (!base64FormatValidation.isValid) {
                const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, {
                  field: 'file.base64',
                });
                emitErrorWithDeduplication(socket, {
                  code: error.code,
                  message: `File "${file.name}" has invalid base64 encoding: ${base64FormatValidation.error}`,
                }, undefined, 'start-dialogue');
                return;
              }

              // Verify file content matches declared MIME type using magic numbers
              try {
                const contentMatches = verifyFileFromBase64(file.base64, file.type);
                if (!contentMatches) {
                  const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, {
                    field: 'file.content',
                  });
                  emitErrorWithDeduplication(socket, {
                    code: error.code,
                    message: `File "${file.name}" content does not match declared type "${file.type}". The file may be corrupted or the type may be incorrect.`,
                  }, undefined, 'start-dialogue');
                  return;
                }
              } catch (verificationError) {
                logger.error('File content verification failed', {
                  error: verificationError instanceof Error ? verificationError.message : String(verificationError),
                  fileName: file.name,
                  fileType: file.type,
                });
                const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, {
                  field: 'file.content',
                });
                emitErrorWithDeduplication(socket, {
                  code: error.code,
                  message: `File "${file.name}" verification failed. Please ensure the file is valid and try again.`,
                }, undefined, 'start-dialogue');
                return;
              }
            }
          }
        }

        // Server-side validation
        let validationResult;
        try {
          validationResult = dialogueRequestSchema.safeParse(data);
        } catch (validationError) {
          logger.error('Error during validation', { error: validationError, socketId: socket.id });
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { validationError });
          emitErrorWithDeduplication(socket, error, undefined, 'start-dialogue');
          return;
        }

        if (!validationResult.success) {
          const errors = validationResult.error.issues
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join(', ');
          const validationError = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { errors });
          emitErrorWithDeduplication(socket, {
            code: validationError.code,
            message: `Invalid input: ${errors}. Please correct and try again.`,
          }, undefined, 'start-dialogue');
          return;
        }

        const { topic, files = [], userId } = validationResult.data;

        // Rate limiting check (after validation - only count valid requests)
        const clientIpProceed = extractClientIP(socket);
        const effectiveUserId2 = userId || getSocketUserId(socket);
        const userTier = getUserRateLimitTier(effectiveUserId2, socket.data.user ? { user: socket.data.user } : null);
        const rateLimitExceeded = await checkRateLimit(clientIpProceed, userTier);
        if (rateLimitExceeded) {
          logger.warn('Rate limit exceeded', { socketId: socket.id, clientIp: clientIpProceed, tier: userTier });
          const { getRateLimitInfo } = await import('@/lib/rate-limit');
          const rateLimitInfo = getRateLimitInfo(clientIpProceed, userTier);
          const _resetTime = new Date(rateLimitInfo.reset);
          const secondsUntilReset = Math.ceil((rateLimitInfo.reset - Date.now()) / 1000);

          const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED, { clientIp });
          emitErrorWithDeduplication(socket, {
            code: error.code,
            message: `Rate limit exceeded. Please try again in ${secondsUntilReset} second${secondsUntilReset !== 1 ? 's' : ''}.`,
          }, undefined, 'start-dialogue');
          return;
        }

        // Validate LLM provider availability before starting dialogue
        const providerAvailability = checkLLMProviderAvailability();
        if (!providerAvailability.available) {
          const errorDetails = providerAvailability.errors
            .map((e) => `${e.provider}: ${e.error}`)
            .join('; ');
          logger.error('No LLM providers available when starting dialogue', {
            socketId: socket.id,
            errors: providerAvailability.errors,
          });
          const error = createErrorFromCode(ErrorCode.NO_LLM_PROVIDER_AVAILABLE, {
            errors: providerAvailability.errors,
          });
          emitErrorWithDeduplication(socket, {
            code: error.code,
            message: `No AI providers are configured. Please set at least one API key (GROQ_API_KEY, MISTRAL_API_KEY, or OPENROUTER_API_KEY). Errors: ${errorDetails}`,
          }, undefined, 'start-dialogue');
          return;
        }

        logger.info('LLM provider availability check passed', {
          socketId: socket.id,
          availableProviders: providerAvailability.providers,
        });

        // Check database health (non-blocking, will use graceful degradation if needed)
        const dbHealthy = checkDatabaseHealth();
        if (!dbHealthy) {
          logger.warn(
            'Database is not healthy, dialogue will continue with limited functionality',
            {
              socketId: socket.id,
            }
          );
          // Continue anyway - we'll handle database errors gracefully in the dialogue processing
        }

        // Always use round-based discussion system
        // Get user ID from authenticated socket or use provided userId
        const effectiveUserId3 = userId || getSocketUserId(socket);

        // Atomically check for active discussion to prevent race conditions
        // This prevents multiple requests from creating discussions simultaneously
        const { checkActiveDiscussionAtomically } = await import('@/lib/db/discussions');
        let hasActiveDiscussion = false;

        try {
          // Atomically check for active discussion in database
          // Uses file locking to get exclusive lock and prevent race conditions
          // In development, use shorter stuck threshold (5 minutes) to auto-resolve stuck discussions faster
          const isDev = SERVER_CONFIG.NODE_ENV !== 'production';
          const stuckThreshold = isDev ? 5 * 60 * 1000 : 60 * 60 * 1000; // 5 min in dev, 1 hour in prod
          const activeDiscussion = await checkActiveDiscussionAtomically(effectiveUserId3, true, stuckThreshold);

          if (activeDiscussion) {
            // Active discussion exists
            hasActiveDiscussion = true;
            logger.warn('User attempted to start new discussion with active one', {
              userId: effectiveUserId3,
              activeDiscussionId: activeDiscussion.id,
              socketId: socket.id,
            });
            const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, {
              reason: 'active_discussion_exists',
            });
            emitErrorWithDeduplication(socket, {
              code: error.code,
              message:
                'You already have an active discussion. Please resolve or delete your current discussion before starting a new one.',
            }, undefined, 'start-dialogue');
            return; // Prevent creating new discussion
          }

          // No active discussion, create files first (source of truth), then sync to database
          const fileResult = await syncFileAndDatabase(
            () => createDiscussionFiles(effectiveUserId3, topic),
            (result) =>
              createDiscussion(effectiveUserId3, topic, result.jsonPath, result.mdPath, result.id),
            { userId: effectiveUserId3, operation: 'createDiscussion' }
          );
          const discussionId = fileResult.id;

          // Get the discussion from database to pass to processDiscussionDialogueRounds
          // This ensures the discussion exists before processing
          const discussion = getDiscussion(discussionId, effectiveUserId3);
          if (!discussion) {
            logger.error('Discussion not found immediately after creation', {
              discussionId,
              userId: effectiveUserId3,
              socketId: socket.id,
            });
            const error = createErrorFromCode(ErrorCode.INTERNAL_ERROR, { discussionId });
            emitErrorWithDeduplication(socket, error, discussionId, 'start-dialogue');
            return;
          }

          // Leave previous discussion room if exists, then join new discussion room
          const previousDiscussionId = socket.data?.previousDiscussionId;
          if (previousDiscussionId && previousDiscussionId !== discussionId) {
            socket.leave(previousDiscussionId);
            logger.debug('Left previous discussion room', {
              socketId: socket.id,
              previousDiscussionId,
              newDiscussionId: discussionId,
            });
          }
          socket.join(discussionId);
          // Store current discussionId for future cleanup
          if (!socket.data) socket.data = {};
          socket.data.previousDiscussionId = discussionId;

          // Emit discussion started
          socket.emit('discussion-started', {
            discussionId,
            hasActiveDiscussion,
          });

          // Send acknowledgment
          if (ack) {
            ack({ data: { discussionId, hasActiveDiscussion } });
          }

          logger.info('Discussion started', {
            discussionId,
            userId: effectiveUserId3,
            socketId: socket.id,
            isAnonymous: !userId,
          });

          // Start the dialogue loop (using round-based processing)
          logger.info('Starting dialogue processing (round-based)', {
            discussionId,
            userId: effectiveUserId3,
            socketId: socket.id,
          });
          try {
            await processDiscussionDialogueRounds(
              io,
              socket,
              discussionId,
              effectiveUserId3,
              topic,
              files || [],
              discussion
            );
          } catch (dialogueError) {
            logger.error('Error in processDiscussionDialogueRounds', {
              error: dialogueError instanceof Error ? dialogueError.message : String(dialogueError),
              errorStack: dialogueError instanceof Error ? dialogueError.stack : undefined,
              discussionId,
              userId: effectiveUserId3,
              socketId: socket.id,
            });
            // Emit error with discussionId
            const error = createErrorFromCode(ErrorCode.INTERNAL_ERROR, { discussionId });
            emitErrorToRoomWithDeduplication(
              io,
              discussionId,
              {
                code: error.code,
                message:
                  dialogueError instanceof Error
                    ? dialogueError.message
                    : 'Failed to process dialogue. Please try again.',
              },
              'process-dialogue-rounds'
            );
            throw dialogueError;
          }
        } catch (error) {
          logger.error('Error creating discussion', {
            error,
            userId: effectiveUserId3,
            socketId: socket.id,
          });
          const errorObj = createErrorFromCode(ErrorCode.INTERNAL_ERROR, {
            userId: effectiveUserId3,
          });
          emitErrorWithDeduplication(socket, {
            code: errorObj.code,
            message:
              error instanceof Error
                ? error.message
                : 'Failed to create discussion. Please try again.',
          }, undefined, 'start-dialogue');
          return;
        }
      } catch (error) {
        logger.error('Error starting dialogue', {
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          socketId: socket.id,
        });
        // Try to get discussionId if it was created
        const discussionId =
          error && typeof error === 'object' && 'discussionId' in error
            ? (error as { discussionId?: string }).discussionId
            : undefined;
        const errorObj = createErrorFromCode(ErrorCode.INTERNAL_ERROR, { discussionId });
        emitErrorWithDeduplication(socket, {
          code: errorObj.code,
          message:
            error instanceof Error ? error.message : 'Failed to start dialogue. Please try again.',
          discussionId,
        }, discussionId, 'start-dialogue');
      }
    });

    // Handle question answers submission
    socket.on('submit-answers', async (data: SubmitAnswersEvent, ack?: (response: { error?: string; data?: unknown }) => void) => {
      if (!checkMessageLimits(data)) {
        if (ack) ack({ error: 'Message limits exceeded' });
        return;
      }
      logger.info('Received submit-answers event', {
        socketId: socket.id,
        discussionId: data?.discussionId,
        roundNumber: data?.roundNumber,
      });

      try {
        // Rate limiting check
        const clientIp = extractClientIP(socket);
        if (await checkRateLimit(clientIp)) {
          logger.warn('Rate limit exceeded for answer submission', {
            socketId: socket.id,
            clientIp,
          });
          const { getRateLimitInfo } = await import('@/lib/rate-limit');
          const rateLimitInfo = getRateLimitInfo(clientIp);
          const secondsUntilReset = Math.ceil((rateLimitInfo.reset - Date.now()) / 1000);
          const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED, { clientIp });
          emitErrorWithDeduplication(socket, {
            code: error.code,
            message: `Rate limit exceeded. Please try again in ${secondsUntilReset} second${secondsUntilReset !== 1 ? 's' : ''}.`,
          }, data?.discussionId, 'submit-answers');
          return;
        }

        const { discussionId, roundNumber, answers } = data;

        if (!discussionId) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'discussionId' });
          emitErrorWithDeduplication(socket, error, undefined, 'submit-answers');
          return;
        }

        if (!roundNumber || roundNumber < 1) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'roundNumber' });
          emitErrorWithDeduplication(socket, error, discussionId, 'submit-answers');
          return;
        }

        if (!answers || Object.keys(answers).length === 0) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'answers' });
          emitErrorWithDeduplication(socket, error, discussionId, 'submit-answers');
          return;
        }

        // Get user ID from authenticated socket
        const userId = getSocketUserId(socket);
        const discussion = getDiscussion(discussionId, userId);
        if (!discussion) {
          logger.error('Discussion not found for answer submission', {
            socketId: socket.id,
            discussionId,
          });
          const notFoundError = createErrorFromCode(ErrorCode.DISCUSSION_NOT_FOUND, {
            discussionId,
          });
          emitErrorWithDeduplication(socket, {
            code: notFoundError.code,
            message: 'Discussion not found. Please start a new dialogue.',
            discussionId,
          }, discussionId, 'submit-answers');
          return;
        }

        // Verify user owns the discussion
        if (!verifyDiscussionOwnership(discussionId, userId)) {
          const authError = createAuthorizationError(discussionId);
          emitErrorWithDeduplication(
            socket,
            { code: authError.code, message: authError.message, discussionId: authError.discussionId },
            discussionId,
            'submit-answers'
          );
          return;
        }

        // Update round answers
        await updateRoundAnswers(discussionId, discussion.user_id, roundNumber, answers);

        logger.info('Answers submitted successfully', {
          discussionId,
          roundNumber,
          answerCount: Object.keys(answers).length,
        });

        // Send acknowledgment
        if (ack) {
          ack({ data: { discussionId, roundNumber } });
        }

        // Continue dialogue with updated context
        await processDiscussionDialogueRounds(
          io,
          socket,
          discussionId,
          discussion.user_id,
          discussion.topic,
          [],
          discussion
        );
      } catch (error) {
        logger.error('Error handling answer submission', { error, socketId: socket.id });
        const discussionId = data?.discussionId;
        const errorObj = createErrorFromCode(ErrorCode.INTERNAL_ERROR, { discussionId });
        emitErrorWithDeduplication(socket, {
          code: errorObj.code,
          message:
            error instanceof Error ? error.message : 'Failed to process answers. Please try again.',
          discussionId,
        }, discussionId, 'submit-answers');
      }
    });

    // Handle proceed-dialogue event
    socket.on('proceed-dialogue', async (data: ProceedDialogueEvent, ack?: (response: { error?: string; data?: unknown }) => void) => {
      if (!checkMessageLimits(data)) {
        if (ack) ack({ error: 'Message limits exceeded' });
        return;
      }
      logger.info('Received proceed-dialogue event', {
        socketId: socket.id,
        discussionId: data?.discussionId,
      });

      try {
        // Rate limiting check
        const clientIp = extractClientIP(socket);
        if (await checkRateLimit(clientIp)) {
          logger.warn('Rate limit exceeded for proceed-dialogue', {
            socketId: socket.id,
            clientIp,
          });
          const { getRateLimitInfo } = await import('@/lib/rate-limit');
          const rateLimitInfo = getRateLimitInfo(clientIp);
          const secondsUntilReset = Math.ceil((rateLimitInfo.reset - Date.now()) / 1000);
          const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED, { clientIp });
          emitErrorWithDeduplication(socket, {
            code: error.code,
            message: `Rate limit exceeded. Please try again in ${secondsUntilReset} second${secondsUntilReset !== 1 ? 's' : ''}.`,
          }, data?.discussionId, 'proceed-dialogue');
          return;
        }

        const { discussionId } = data;

        if (!discussionId) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'discussionId' });
          emitErrorWithDeduplication(socket, error, undefined, 'proceed-dialogue');
          return;
        }

        // Get user ID from authenticated socket
        const userId = getSocketUserId(socket);
        const discussion = getDiscussion(discussionId, userId);
        if (!discussion) {
          logger.error('Discussion not found for proceed-dialogue', {
            socketId: socket.id,
            discussionId,
          });
          const notFoundError = createErrorFromCode(ErrorCode.DISCUSSION_NOT_FOUND, {
            discussionId,
          });
          emitErrorWithDeduplication(socket, {
            code: notFoundError.code,
            message: 'Discussion not found. Please start a new dialogue.',
            discussionId,
          }, discussionId, 'proceed-dialogue');
          return;
        }

        // Verify user owns the discussion
        if (!verifyDiscussionOwnership(discussionId, userId)) {
          const authError = createAuthorizationError(discussionId);
          emitErrorWithDeduplication(
            socket,
            { code: authError.code, message: authError.message, discussionId: authError.discussionId },
            discussionId,
            'proceed-dialogue'
          );
          if (ack) ack({ error: authError.message });
          return;
        }

        // Send acknowledgment before starting async processing
        if (ack) {
          ack({ data: { discussionId } });
        }

        // Continue to next round
        await processDiscussionDialogueRounds(
          io,
          socket,
          discussionId,
          discussion.user_id,
          discussion.topic,
          [],
          discussion
        );
      } catch (error) {
        logger.error('Error handling proceed-dialogue', { error, socketId: socket.id });
        const discussionId = data?.discussionId;
        const errorObj = createErrorFromCode(ErrorCode.INTERNAL_ERROR, { discussionId });
        emitErrorWithDeduplication(socket, {
          code: errorObj.code,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to proceed with dialogue. Please try again.',
          discussionId,
        }, discussionId, 'proceed-dialogue');
      }
    });

    // Handle generate-questions event
    socket.on('generate-questions', async (data: GenerateQuestionsEvent, ack?: (response: { error?: string; data?: unknown }) => void) => {
      if (!checkMessageLimits(data)) {
        if (ack) ack({ error: 'Message limits exceeded' });
        return;
      }
      logger.info('Received generate-questions event', {
        socketId: socket.id,
        discussionId: data?.discussionId,
        roundNumber: data?.roundNumber,
      });

      try {
        // Rate limiting check
        const clientIp = extractClientIP(socket);
        if (await checkRateLimit(clientIp)) {
          logger.warn('Rate limit exceeded for generate-questions', {
            socketId: socket.id,
            clientIp,
          });
          const { getRateLimitInfo } = await import('@/lib/rate-limit');
          const rateLimitInfo = getRateLimitInfo(clientIp);
          const secondsUntilReset = Math.ceil((rateLimitInfo.reset - Date.now()) / 1000);
          const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED, { clientIp });
          emitErrorWithDeduplication(socket, {
            code: error.code,
            message: `Rate limit exceeded. Please try again in ${secondsUntilReset} second${secondsUntilReset !== 1 ? 's' : ''}.`,
          }, data?.discussionId, 'generate-questions');
          return;
        }

        const { discussionId, roundNumber } = data;

        if (!discussionId) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'discussionId' });
          emitErrorWithDeduplication(socket, error, undefined, 'generate-questions');
          return;
        }

        // Get user ID from authenticated socket
        const userId = getSocketUserId(socket);
        const discussion = getDiscussion(discussionId, userId);
        if (!discussion) {
          logger.error('Discussion not found for generate-questions', {
            socketId: socket.id,
            discussionId,
          });
          const notFoundError = createErrorFromCode(ErrorCode.DISCUSSION_NOT_FOUND, {
            discussionId,
          });
          emitErrorWithDeduplication(socket, {
            code: notFoundError.code,
            message: 'Discussion not found. Please start a new dialogue.',
            discussionId,
          }, discussionId, 'generate-questions');
          return;
        }

        // Load discussion data
        const discussionData = await readDiscussion(discussionId, discussion.user_id);
        const discussionContext = await loadDiscussionContext(discussionId, discussion.user_id);

        // Sync token count from file (source of truth) to database
        try {
          syncTokenCountFromFile(discussionId, discussionContext.tokenCount);
        } catch (syncError) {
          logger.warn('Failed to sync token count to database', {
            error: syncError,
            discussionId,
            tokenCount: discussionContext.tokenCount,
          });
        }

        // Determine which round to generate questions for
        const targetRoundNumber = roundNumber || discussionData.currentRound || 0;
        const targetRound = (discussionData.rounds || []).find(
          (r) => r.roundNumber === targetRoundNumber
        );

        if (!targetRound) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, {
            reason: 'round_not_found',
            roundNumber: targetRoundNumber,
          });
          emitErrorWithDeduplication(socket, {
            code: error.code,
            message: `Round ${targetRoundNumber} not found.`,
            discussionId,
          }, discussionId, 'generate-questions');
          return;
        }

        // Get previous rounds and current summary
        const previousRounds = (discussionData.rounds || []).filter(
          (r) => r.roundNumber < targetRoundNumber
        );
        const currentSummary = discussionContext.currentSummary;

        // Generate questions
        const questionSet = await generateQuestions(
          discussionId,
          discussion.user_id,
          discussion.topic,
          targetRound,
          currentSummary,
          previousRounds
        );

        // Store question set
        await addQuestionSetToDiscussion(discussionId, discussion.user_id, questionSet);

        // Update round with questions
        targetRound.questions = questionSet;
        await addRoundToDiscussion(discussionId, discussion.user_id, targetRound);

        // Emit questions generated
        io.to(discussionId).emit('questions-generated', {
          discussionId: discussionId,
          questionSet,
          roundNumber: targetRoundNumber,
        });

        // Send acknowledgment
        if (ack) {
          ack({ data: { discussionId, questionSet, roundNumber: targetRoundNumber } });
        }

        logger.info('Questions generated successfully', {
          discussionId,
          roundNumber: targetRoundNumber,
          questionCount: questionSet.questions.length,
        });
      } catch (error) {
        logger.error('Error handling generate-questions', { error, socketId: socket.id });
        const discussionId = data?.discussionId;
        const errorObj = createErrorFromCode(ErrorCode.INTERNAL_ERROR, { discussionId });
        emitErrorWithDeduplication(socket, {
          code: errorObj.code,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to generate questions. Please try again.',
          discussionId,
        }, discussionId, 'generate-questions');
      }
    });

    socket.on('disconnect', async () => {
      await unregisterConnection(socket);
      logger.info('Client disconnected', { socketId: socket.id });
    });
  });
}

/**
 * Process dialogue for discussion-based system using round-based structure
 * New enhanced version that processes rounds instead of individual messages
 */
/**
 * Load discussion data and context with error handling
 */
async function loadDiscussionDataAndContext(
  io: Server,
  discussionId: string,
  userId: string
): Promise<{
  discussionData: Awaited<ReturnType<typeof readDiscussion>>;
  discussionContext: Awaited<ReturnType<typeof loadDiscussionContext>>;
}> {
  // Load discussion data to get current round
  let discussionData;
  try {
    discussionData = await readDiscussion(discussionId, userId);
    logger.debug('Discussion data loaded', {
      discussionId,
      currentRound: discussionData.currentRound,
      roundsCount: discussionData.rounds?.length || 0,
    });
  } catch (error) {
    logger.error('Error loading discussion data', {
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      discussionId,
      userId,
    });
    emitErrorToRoomWithDeduplication(
      io,
      discussionId,
      {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Failed to load discussion data. Please try again.',
      },
      'load-discussion-data'
    );
    throw error;
  }

  // Load discussion context
  let discussionContext;
  try {
    discussionContext = await loadDiscussionContext(discussionId, userId);
    logger.debug('Discussion context loaded', {
      discussionId,
      tokenCount: discussionContext.tokenCount,
      roundsCount: discussionContext.rounds?.length || 0,
      hasSummary: !!discussionContext.currentSummary,
      summariesCount: discussionContext.summaries?.length || 0,
    });

    // Sync token count from file (source of truth) to database
    try {
      syncTokenCountFromFile(discussionId, discussionContext.tokenCount);
    } catch (syncError) {
      logger.warn('Failed to sync token count to database', {
        error: syncError instanceof Error ? syncError.message : String(syncError),
        discussionId,
        tokenCount: discussionContext.tokenCount,
      });
    }
  } catch (error) {
    logger.error('Error loading discussion context', {
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      discussionId,
      userId,
    });
    emitErrorToRoomWithDeduplication(
      io,
      discussionId,
      {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Failed to load discussion context. Please try again.',
      },
      'load-discussion-context'
    );
    throw error;
  }

  return { discussionData, discussionContext };
}

/**
 * Process a single round: generate all three AI responses
 * Execution order: Analyzer → Solver → Moderator
 * Turn numbers: Analyzer = (round-1)*3+1, Solver = (round-1)*3+2, Moderator = (round-1)*3+3
 *
 * CRITICAL: This function MUST execute personas in the exact order: Analyzer → Solver → Moderator
 * Any deviation from this order is a critical bug and will be logged and throw an error.
 */
async function processSingleRound(
  io: Server,
  discussionId: string,
  topic: string,
  discussionContext: Awaited<ReturnType<typeof loadDiscussionContext>>,
  isFirstRound: boolean,
  files: FileData[],
  currentRoundNumber: number,
  userAnswers: Record<string, string[]>
): Promise<DiscussionRound> {
  // CRITICAL EXECUTION ORDER SAFEGUARD: Use centralized execution order from execution-order.ts
  // This is the SINGLE SOURCE OF TRUTH for execution order
  // EXECUTION_ORDER is imported from '@/lib/discussions/execution-order'

  // Get personas - order of retrieval doesn't matter, but we validate names
  const analyzerPersona = aiPersonas.analyzer;
  const solverPersona = aiPersonas.solver;
  const moderatorPersona = aiPersonas.moderator;

  // CRITICAL: Log execution order at function entry
  logger.info('🚀 ROUND EXECUTION START', {
    discussionId,
    roundNumber: currentRoundNumber,
    executionOrder: EXECUTION_ORDER,
    timestamp: new Date().toISOString(),
    function: 'processSingleRound',
  });

  // CRITICAL DEBUG: Log persona assignments to verify they're correct
  logger.info('🔍 DEBUG: Persona assignments verification', {
    discussionId,
    roundNumber: currentRoundNumber,
    analyzerPersonaId: analyzerPersona.id,
    analyzerPersonaName: analyzerPersona.name,
    analyzerPersonaProvider: analyzerPersona.provider,
    solverPersonaId: solverPersona.id,
    solverPersonaName: solverPersona.name,
    solverPersonaProvider: solverPersona.provider,
    moderatorPersonaId: moderatorPersona.id,
    moderatorPersonaName: moderatorPersona.name,
    moderatorPersonaProvider: moderatorPersona.provider,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL FIX 1.1: Explicit persona validation at start
  // Verify persona assignments are correct before processing
  if (analyzerPersona.name !== 'Analyzer AI') {
    logger.error('🚨 CRITICAL: Analyzer persona name mismatch', {
      discussionId,
      roundNumber: currentRoundNumber,
      expected: 'Analyzer AI',
      actual: analyzerPersona.name,
    });
    throw new Error(`Invalid Analyzer persona: expected 'Analyzer AI', got '${analyzerPersona.name}'`);
  }
  if (solverPersona.name !== 'Solver AI') {
    logger.error('🚨 CRITICAL: Solver persona name mismatch', {
      discussionId,
      roundNumber: currentRoundNumber,
      expected: 'Solver AI',
      actual: solverPersona.name,
    });
    throw new Error(`Invalid Solver persona: expected 'Solver AI', got '${solverPersona.name}'`);
  }
  if (moderatorPersona.name !== 'Moderator AI') {
    logger.error('🚨 CRITICAL: Moderator persona name mismatch', {
      discussionId,
      roundNumber: currentRoundNumber,
      expected: 'Moderator AI',
      actual: moderatorPersona.name,
    });
    throw new Error(`Invalid Moderator persona: expected 'Moderator AI', got '${moderatorPersona.name}'`);
  }

  logger.info('Starting round processing', {
    discussionId,
    roundNumber: currentRoundNumber,
    isFirstRound,
    hasFiles: files.length > 0,
    analyzerPersona: analyzerPersona.name,
    solverPersona: solverPersona.name,
    moderatorPersona: moderatorPersona.name,
  });

  // CRITICAL: Validate persona execution order
  // CORRECT ORDER: Analyzer → Solver → Moderator (verified and confirmed by user)
  // This validation ensures the order is maintained throughout processing
  // Using centralized EXECUTION_ORDER from execution-order.ts (single source of truth)
  logger.info('🔄 EXECUTION ORDER VALIDATION: Processing round with order', {
    discussionId,
    roundNumber: currentRoundNumber,
    expectedOrder: EXECUTION_ORDER,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL: Validate execution order using centralized validation
  // Convert readonly array to mutable for validation
  const orderValidation = validateExecutionOrder([...EXECUTION_ORDER]);
  if (!orderValidation.isValid) {
    logger.error('🚨 CRITICAL: Execution order validation failed at function entry', {
      discussionId,
      roundNumber: currentRoundNumber,
      error: orderValidation.error,
      executionOrder: EXECUTION_ORDER,
    });
    throw new Error(`Execution order validation failed: ${orderValidation.error}`);
  }

  // Log execution order validation
  logExecutionOrderValidation(
    { discussionId, roundNumber: currentRoundNumber, operation: 'processSingleRound' },
    [...EXECUTION_ORDER]
  );

  // Process Analyzer AI response first
  // Only Analyzer in Round 1 with no previous rounds should get isFirstMessage = true
  // Solver and Moderator always respond to previous messages, never as first message

  // CRITICAL FIX: Use standardized filtering function for Analyzer context
  // Analyzer should only see complete rounds (all 3 responses) when starting a new round
  // This prevents Analyzer from incorrectly seeing Solver's response from an incomplete round

  // CRITICAL AUDIT: Verify current round is NOT in discussionContext before filtering
  const currentRoundInContext = (discussionContext.rounds || []).find(
    (r) => r.roundNumber === currentRoundNumber
  );
  if (currentRoundInContext) {
    logger.error('🚨 CRITICAL BUG: Current round found in discussionContext before Analyzer execution!', {
      discussionId,
      roundNumber: currentRoundNumber,
      currentRoundInContext: {
        roundNumber: currentRoundInContext.roundNumber,
        hasAnalyzer: !!currentRoundInContext.analyzerResponse?.content?.trim(),
        hasSolver: !!currentRoundInContext.solverResponse?.content?.trim(),
        hasModerator: !!currentRoundInContext.moderatorResponse?.content?.trim(),
      },
      note: 'This indicates a race condition or incorrect context loading - Analyzer should never see current round',
    });
  // ALL LLMs see ALL rounds - no filtering needed
  // Execution order is enforced separately and does not affect context visibility
  const contextForAnalyzer = discussionContext;

  // Log context details for Analyzer
  logger.info('🔍 AUDIT: Analyzer context before execution', {
    discussionId,
    roundNumber: currentRoundNumber,
    roundsCount: contextForAnalyzer.rounds?.length || 0,
    roundNumbers: contextForAnalyzer.rounds?.map((r) => r.roundNumber) || [],
    hasCurrentRound: contextForAnalyzer.rounds?.some(
      (r) => r.roundNumber === currentRoundNumber
    ) || false,
    lastRound: contextForAnalyzer.rounds && contextForAnalyzer.rounds.length > 0
      ? {
          roundNumber: contextForAnalyzer.rounds[contextForAnalyzer.rounds.length - 1].roundNumber,
          lastPersona: contextForAnalyzer.rounds[contextForAnalyzer.rounds.length - 1].moderatorResponse?.persona,
          lastPersonaContent: contextForAnalyzer.rounds[contextForAnalyzer.rounds.length - 1].moderatorResponse?.content?.substring(0, 100),
        }
      : null,
    // Note: All rounds are included in context for all LLMs
    hasSolverInContext: contextForAnalyzer.rounds?.some((r) =>
      r.solverResponse?.content?.trim() && r.roundNumber !== currentRoundNumber
    ) || false,
    solverResponsesInContext: contextForAnalyzer.rounds
      ?.filter((r) => r.solverResponse?.content?.trim() && r.roundNumber !== currentRoundNumber)
      .map((r) => ({
        roundNumber: r.roundNumber,
        solverContent: r.solverResponse?.content?.substring(0, 50),
      })) || [],
    timestamp: new Date().toISOString(),
  });

  // ALL LLMs see ALL rounds - no filtering needed
  // Check for rounds that might have content (from previous attempts)
  const hasAnyRoundContent = contextForAnalyzer.rounds?.some((round) => {
    return (
      (round.analyzerResponse?.content && round.analyzerResponse.content.trim().length > 0) ||
      (round.solverResponse?.content && round.solverResponse.content.trim().length > 0) ||
      (round.moderatorResponse?.content && round.moderatorResponse.content.trim().length > 0)
    );
  }) || false;

  // Only treat as first message if:
  // 1. It's Round 1
  // 2. No rounds exist OR no rounds have any content
  // 3. No messages exist
  const isFirstMessage = isFirstRound &&
    !hasAnyRoundContent &&
    (contextForAnalyzer.rounds?.length === 0 || !contextForAnalyzer.rounds) &&
    (contextForAnalyzer.messages?.length === 0 || !contextForAnalyzer.messages);

  // CRITICAL FIX 1.1: Calculate expected turn BEFORE execution
  const expectedAnalyzerTurn = calculateTurnNumber(currentRoundNumber, 'Analyzer AI');

  logger.info('🔄 EXECUTION ORDER: Starting Analyzer AI response (FIRST)', {
    discussionId,
    roundNumber: currentRoundNumber,
    expectedTurn: expectedAnalyzerTurn,
    isFirstMessage,
    isFirstRound,
    previousRoundsCount: discussionContext.rounds?.length || 0,
    hasAnyRoundContent,
    roundsWithContent: discussionContext.rounds?.filter((r) =>
      (r.analyzerResponse?.content?.trim() || r.solverResponse?.content?.trim() || r.moderatorResponse?.content?.trim())
    ).length || 0,
    timestamp: new Date().toISOString(),
  });
  // CRITICAL: Log before generating Analyzer response to track execution order
  logger.info('🚀 EXECUTING ANALYZER: About to call generateAIResponse for Analyzer AI', {
    discussionId,
    roundNumber: currentRoundNumber,
    expectedTurn: expectedAnalyzerTurn,
    personaName: analyzerPersona.name,
    personaId: analyzerPersona.id,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL DEBUG: Log before calling generateAIResponse for Analyzer
  logger.info('🔍 DEBUG: About to call generateAIResponse for Analyzer', {
    discussionId,
    roundNumber: currentRoundNumber,
    personaId: analyzerPersona.id,
    personaName: analyzerPersona.name,
    expectedTurn: expectedAnalyzerTurn,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL RUNTIME VALIDATION: Verify Analyzer can execute (should be first)
  const analyzerValidation = validatePersonaCanExecute('Analyzer AI', []);
  if (!analyzerValidation.isValid) {
    logger.error('🚨 CRITICAL: Analyzer execution validation failed', {
      discussionId,
      roundNumber: currentRoundNumber,
      error: analyzerValidation.error,
    });
    throw new Error(`Analyzer execution validation failed: ${analyzerValidation.error}`);
  }

  // CRITICAL RUNTIME VALIDATION: Verify no responses exist for current round
  const currentRoundResponses = (discussionContext.rounds || [])
    .find((r) => r.roundNumber === currentRoundNumber);
  if (currentRoundResponses) {
    const hasSolver = !!currentRoundResponses.solverResponse?.content?.trim();
    const hasModerator = !!currentRoundResponses.moderatorResponse?.content?.trim();
    if (hasSolver || hasModerator) {
      logger.error('🚨 CRITICAL: Current round has responses before Analyzer execution!', {
        discussionId,
        roundNumber: currentRoundNumber,
        hasSolver,
        hasModerator,
        solverContent: currentRoundResponses.solverResponse?.content?.substring(0, 100),
        note: 'This indicates Solver executed before Analyzer - CRITICAL BUG',
      });
      throw new Error('Current round has responses before Analyzer execution - execution order violation');
    }
  }

  const analyzerResponse = await generateAIResponse(
    io,
    discussionId,
    analyzerPersona,
    topic,
    contextForAnalyzer, // All LLMs see all rounds
    isFirstMessage,
    files,
    currentRoundNumber,
    userAnswers
  );

  // CRITICAL: Validate Analyzer response immediately after generation
  logger.info('✅ EXECUTION ORDER: Analyzer AI response completed', {
    discussionId,
    roundNumber: currentRoundNumber,
    turn: analyzerResponse.turn,
    expectedTurn: expectedAnalyzerTurn,
    persona: analyzerResponse.persona,
    responseLength: analyzerResponse.content.length,
    responsePreview: analyzerResponse.content.substring(0, 100),
    timestamp: new Date().toISOString(),
  });

  // CRITICAL DEBUG: Verify the response actually came from Analyzer
  if (analyzerResponse.persona !== 'Analyzer AI') {
    logger.error('🚨 CRITICAL BUG: analyzerResponse variable contains wrong persona!', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedPersona: 'Analyzer AI',
      actualPersona: analyzerResponse.persona,
      actualTurn: analyzerResponse.turn,
      expectedTurn: expectedAnalyzerTurn,
      note: 'This indicates generateAIResponse returned wrong persona or variables are swapped',
    });
  }

  // CRITICAL: Verify Analyzer response persona and turn immediately
  if (analyzerResponse.persona !== 'Analyzer AI') {
    logger.error('🚨 CRITICAL: Analyzer response has wrong persona immediately after generation', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedPersona: 'Analyzer AI',
      actualPersona: analyzerResponse.persona,
    });
    throw new Error(`Analyzer response persona mismatch: expected 'Analyzer AI', got '${analyzerResponse.persona}'`);
  }

  // CRITICAL FIX 1.1: Validate turn number matches expected
  if (analyzerResponse.turn !== expectedAnalyzerTurn) {
    logger.error('🚨 CRITICAL: Analyzer turn number mismatch', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedTurn: expectedAnalyzerTurn,
      actualTurn: analyzerResponse.turn,
    });
    throw new Error(`Analyzer turn number mismatch: expected ${expectedAnalyzerTurn}, got ${analyzerResponse.turn}`);
  }

  // CRITICAL FIX: Validate response completeness - minimum length and proper punctuation
  const analyzerContent = analyzerResponse.content.trim();
  const analyzerMinLength = 800; // Minimum expected length (2-4 paragraphs)
  if (analyzerContent.length < analyzerMinLength) {
    logger.warn('⚠️ Analyzer response is shorter than expected minimum length', {
      discussionId,
      roundNumber: currentRoundNumber,
      responseLength: analyzerContent.length,
      expectedMinLength: analyzerMinLength,
      difference: analyzerMinLength - analyzerContent.length,
      note: 'Response may be incomplete or truncated',
    });
  }
  if (!/[.!?]\s*$/.test(analyzerContent)) {
    logger.warn('⚠️ Analyzer response does not end with proper punctuation', {
      discussionId,
      roundNumber: currentRoundNumber,
      responseLength: analyzerContent.length,
      lastChars: analyzerContent.slice(-50),
      note: 'Response may be incomplete',
    });
  }

  // For Solver's context, include Analyzer's response
  // CRITICAL: This is a temporary round object for context only - never persisted to file
  // The context needs to reflect the current processing state, not just what's in storage
  // This ensures Solver sees Analyzer's response even though it hasn't been saved yet
  const tempRoundForSolverContext: DiscussionRound = {
    roundNumber: currentRoundNumber,
    analyzerResponse,
    solverResponse: {
      discussion_id: discussionId,
      persona: 'Solver AI',
      content: '',
      turn: calculateTurnNumber(currentRoundNumber, 'Solver AI'),
      timestamp: new Date().toISOString(),
      created_at: Date.now(),
    },
    moderatorResponse: {
      discussion_id: discussionId,
      persona: 'Moderator AI',
      content: '',
      turn: calculateTurnNumber(currentRoundNumber, 'Moderator AI'),
      timestamp: new Date().toISOString(),
      created_at: Date.now(),
    },
    timestamp: new Date().toISOString(),
  };

  // CRITICAL: Build context that includes Analyzer's response for Solver
  // This context accurately reflects the current processing state
  // Note: tempRoundForSolverContext is not in file storage yet, but that's correct
  // - Context should reflect current state during processing
  // - Round will be persisted only after all three responses are complete
  const contextWithAnalyzer = {
    ...discussionContext,
    rounds: filterRoundsForPersona(
      [...(discussionContext.rounds || []), tempRoundForSolverContext],
      'Solver AI',
      currentRoundNumber
    ),
  };

  // CRITICAL: Validate Analyzer response was generated before Solver
  if (!analyzerResponse || !analyzerResponse.content || analyzerResponse.content.trim().length === 0) {
    logger.error('🚨 CRITICAL: Analyzer response is missing or empty before Solver processing', {
      discussionId,
      roundNumber: currentRoundNumber,
      hasAnalyzerResponse: !!analyzerResponse,
      analyzerResponseLength: analyzerResponse?.content?.length || 0,
    });
    throw new Error('Analyzer response must be generated before Solver response');
  }

  // CRITICAL FIX: Explicit execution order guard - Verify Analyzer completed successfully
  if (analyzerResponse.persona !== 'Analyzer AI') {
    logger.error('🚨 CRITICAL EXECUTION ORDER VIOLATION: Analyzer response has wrong persona', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedPersona: 'Analyzer AI',
      actualPersona: analyzerResponse.persona,
      error: 'Cannot proceed to Solver - Analyzer response is invalid',
    });
    throw new Error(`Execution order violation: Analyzer response persona is '${analyzerResponse.persona}', expected 'Analyzer AI'`);
  }
  if (analyzerResponse.turn !== calculateTurnNumber(currentRoundNumber, 'Analyzer AI')) {
    logger.error('🚨 CRITICAL EXECUTION ORDER VIOLATION: Analyzer turn number is incorrect', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedTurn: calculateTurnNumber(currentRoundNumber, 'Analyzer AI'),
      actualTurn: analyzerResponse.turn,
      error: 'Cannot proceed to Solver - Analyzer turn number is invalid',
    });
    throw new Error(`Execution order violation: Analyzer turn number is ${analyzerResponse.turn}, expected ${calculateTurnNumber(currentRoundNumber, 'Analyzer AI')}`);
  }
  logger.info('✅ EXECUTION ORDER GUARD: Analyzer completed successfully, proceeding to Solver', {
    discussionId,
    roundNumber: currentRoundNumber,
    analyzerTurn: analyzerResponse.turn,
    analyzerPersona: analyzerResponse.persona,
    analyzerContentLength: analyzerResponse.content.length,
  });

  // Process Solver AI response second (Order: Analyzer → Solver → Moderator - CORRECT)
  // CRITICAL FIX 1.1: Calculate expected turn BEFORE execution
  const expectedSolverTurn = calculateTurnNumber(currentRoundNumber, 'Solver AI');

  // CRITICAL: Log before generating Solver response to track execution order
  logger.info('🔄 EXECUTION ORDER: Starting Solver AI response (SECOND)', {
    discussionId,
    roundNumber: currentRoundNumber,
    expectedTurn: expectedSolverTurn,
    personaName: solverPersona.name,
    personaId: solverPersona.id,
    analyzerResponseTurn: analyzerResponse.turn, // Verify Analyzer completed first
    analyzerResponsePersona: analyzerResponse.persona,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL DEBUG: Log before calling generateAIResponse for Solver
  logger.info('🔍 DEBUG: About to call generateAIResponse for Solver', {
    discussionId,
    roundNumber: currentRoundNumber,
    personaId: solverPersona.id,
    personaName: solverPersona.name,
    expectedTurn: expectedSolverTurn,
    analyzerResponsePersona: analyzerResponse.persona,
    analyzerResponseTurn: analyzerResponse.turn,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL RUNTIME VALIDATION: Verify Solver can execute (Analyzer must have executed)
  const solverValidation = validatePersonaCanExecute('Solver AI', ['Analyzer AI']);
  if (!solverValidation.isValid) {
    logger.error('🚨 CRITICAL: Solver execution validation failed', {
      discussionId,
      roundNumber: currentRoundNumber,
      error: solverValidation.error,
      analyzerResponsePersona: analyzerResponse.persona,
    });
    throw new Error(`Solver execution validation failed: ${solverValidation.error}`);
  }

  const solverResponse = await generateAIResponse(
    io,
    discussionId,
    solverPersona,
    topic,
    contextWithAnalyzer,
    false,
    undefined,
    currentRoundNumber,
    userAnswers
  );

  // CRITICAL: Validate Solver response immediately after generation
  logger.info('✅ EXECUTION ORDER: Solver AI response completed', {
    discussionId,
    roundNumber: currentRoundNumber,
    turn: solverResponse.turn,
    expectedTurn: expectedSolverTurn,
    persona: solverResponse.persona,
    responseLength: solverResponse.content.length,
    responsePreview: solverResponse.content.substring(0, 100),
    timestamp: new Date().toISOString(),
  });

  // CRITICAL DEBUG: Verify the response actually came from Solver
  if (solverResponse.persona !== 'Solver AI') {
    logger.error('🚨 CRITICAL BUG: solverResponse variable contains wrong persona!', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedPersona: 'Solver AI',
      actualPersona: solverResponse.persona,
      actualTurn: solverResponse.turn,
      expectedTurn: expectedSolverTurn,
      note: 'This indicates generateAIResponse returned wrong persona or variables are swapped',
    });
  }

  // CRITICAL: Verify Solver response persona and turn immediately
  if (solverResponse.persona !== 'Solver AI') {
    logger.error('🚨 CRITICAL: Solver response has wrong persona immediately after generation', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedPersona: 'Solver AI',
      actualPersona: solverResponse.persona,
    });
    throw new Error(`Solver response persona mismatch: expected 'Solver AI', got '${solverResponse.persona}'`);
  }

  // CRITICAL FIX 1.1: Validate turn number matches expected
  if (solverResponse.turn !== expectedSolverTurn) {
    logger.error('🚨 CRITICAL: Solver turn number mismatch', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedTurn: expectedSolverTurn,
      actualTurn: solverResponse.turn,
    });
    throw new Error(`Solver turn number mismatch: expected ${expectedSolverTurn}, got ${solverResponse.turn}`);
  }

  // CRITICAL FIX: Validate response completeness - minimum length and proper punctuation
  const solverContent = solverResponse.content.trim();
  const solverMinLength = 800; // Minimum expected length (2-4 paragraphs)
  if (solverContent.length < solverMinLength) {
    logger.warn('⚠️ Solver response is shorter than expected minimum length', {
      discussionId,
      roundNumber: currentRoundNumber,
      responseLength: solverContent.length,
      expectedMinLength: solverMinLength,
      difference: solverMinLength - solverContent.length,
      note: 'Response may be incomplete or truncated',
    });
  }
  if (!/[.!?]\s*$/.test(solverContent)) {
    logger.warn('⚠️ Solver response does not end with proper punctuation', {
      discussionId,
      roundNumber: currentRoundNumber,
      responseLength: solverContent.length,
      lastChars: solverContent.slice(-50),
      note: 'Response may be incomplete',
    });
  }

  // For Moderator's context, include Analyzer's and Solver's responses
  // CRITICAL: This is a temporary round object for context only - never persisted to file
  // The context needs to reflect the current processing state, not just what's in storage
  // This ensures Moderator sees both Analyzer's and Solver's responses even though they haven't been saved yet
  const tempRoundForModeratorContext: DiscussionRound = {
    roundNumber: currentRoundNumber,
    analyzerResponse,
    solverResponse,
    moderatorResponse: {
      discussion_id: discussionId,
      persona: 'Moderator AI',
      content: '',
      turn: calculateTurnNumber(currentRoundNumber, 'Moderator AI'),
      timestamp: new Date().toISOString(),
      created_at: Date.now(),
    },
    timestamp: new Date().toISOString(),
  };

  // CRITICAL: Build context that includes Analyzer's and Solver's responses for Moderator
  // This context accurately reflects the current processing state
  // Note: tempRoundForModeratorContext is not in file storage yet, but that's correct
  // - Context should reflect current state during processing
  // - Round will be persisted only after all three responses are complete
  const contextWithBoth = {
    ...discussionContext,
    rounds: filterRoundsForPersona(
      [...(discussionContext.rounds || []), tempRoundForModeratorContext],
      'Moderator AI',
      currentRoundNumber
    ),
  };

  // CRITICAL: Validate Solver response was generated before Moderator
  if (!solverResponse || !solverResponse.content || solverResponse.content.trim().length === 0) {
    logger.error('🚨 CRITICAL: Solver response is missing or empty before Moderator processing', {
      discussionId,
      roundNumber: currentRoundNumber,
      hasSolverResponse: !!solverResponse,
      solverResponseLength: solverResponse?.content?.length || 0,
    });
    throw new Error('Solver response must be generated before Moderator response');
  }

  // CRITICAL FIX: Explicit execution order guard - Verify Solver completed successfully
  if (solverResponse.persona !== 'Solver AI') {
    logger.error('🚨 CRITICAL EXECUTION ORDER VIOLATION: Solver response has wrong persona', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedPersona: 'Solver AI',
      actualPersona: solverResponse.persona,
      error: 'Cannot proceed to Moderator - Solver response is invalid',
    });
    throw new Error(`Execution order violation: Solver response persona is '${solverResponse.persona}', expected 'Solver AI'`);
  }
  if (solverResponse.turn !== calculateTurnNumber(currentRoundNumber, 'Solver AI')) {
    logger.error('🚨 CRITICAL EXECUTION ORDER VIOLATION: Solver turn number is incorrect', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedTurn: calculateTurnNumber(currentRoundNumber, 'Solver AI'),
      actualTurn: solverResponse.turn,
      error: 'Cannot proceed to Moderator - Solver turn number is invalid',
    });
    throw new Error(`Execution order violation: Solver turn number is ${solverResponse.turn}, expected ${calculateTurnNumber(currentRoundNumber, 'Solver AI')}`);
  }
  logger.info('✅ EXECUTION ORDER GUARD: Solver completed successfully, proceeding to Moderator', {
    discussionId,
    roundNumber: currentRoundNumber,
    solverTurn: solverResponse.turn,
    solverPersona: solverResponse.persona,
    solverContentLength: solverResponse.content.length,
    analyzerTurn: analyzerResponse.turn,
  });

  // Process Moderator AI response third (Order: Analyzer → Solver → Moderator - CORRECT)
  // CRITICAL FIX 1.1: Calculate expected turn BEFORE execution
  const expectedModeratorTurn = calculateTurnNumber(currentRoundNumber, 'Moderator AI');

  // CRITICAL: Log before generating Moderator response to track execution order
  logger.info('🔄 EXECUTION ORDER: Starting Moderator AI response (THIRD)', {
    discussionId,
    roundNumber: currentRoundNumber,
    expectedTurn: expectedModeratorTurn,
    personaName: moderatorPersona.name,
    personaId: moderatorPersona.id,
    analyzerResponseTurn: analyzerResponse.turn, // Verify Analyzer completed first
    solverResponseTurn: solverResponse.turn, // Verify Solver completed second
    analyzerResponsePersona: analyzerResponse.persona,
    solverResponsePersona: solverResponse.persona,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL DEBUG: Log before calling generateAIResponse for Moderator
  logger.info('🔍 DEBUG: About to call generateAIResponse for Moderator', {
    discussionId,
    roundNumber: currentRoundNumber,
    personaId: moderatorPersona.id,
    personaName: moderatorPersona.name,
    expectedTurn: expectedModeratorTurn,
    analyzerResponsePersona: analyzerResponse.persona,
    analyzerResponseTurn: analyzerResponse.turn,
    solverResponsePersona: solverResponse.persona,
    solverResponseTurn: solverResponse.turn,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL RUNTIME VALIDATION: Verify Moderator can execute (Analyzer and Solver must have executed)
  const moderatorValidation = validatePersonaCanExecute('Moderator AI', ['Analyzer AI', 'Solver AI']);
  if (!moderatorValidation.isValid) {
    logger.error('🚨 CRITICAL: Moderator execution validation failed', {
      discussionId,
      roundNumber: currentRoundNumber,
      error: moderatorValidation.error,
      analyzerResponsePersona: analyzerResponse.persona,
      solverResponsePersona: solverResponse.persona,
    });
    throw new Error(`Moderator execution validation failed: ${moderatorValidation.error}`);
  }

  const moderatorResponse = await generateAIResponse(
    io,
    discussionId,
    moderatorPersona,
    topic,
    contextWithBoth,
    false,
    undefined,
    currentRoundNumber,
    userAnswers
  );

  // CRITICAL: Validate Moderator response immediately after generation
  logger.info('✅ EXECUTION ORDER: Moderator AI response completed', {
    discussionId,
    roundNumber: currentRoundNumber,
    turn: moderatorResponse.turn,
    expectedTurn: expectedModeratorTurn,
    persona: moderatorResponse.persona,
    responseLength: moderatorResponse.content.length,
    responsePreview: moderatorResponse.content.substring(0, 100),
    timestamp: new Date().toISOString(),
  });

  // CRITICAL DEBUG: Verify the response actually came from Moderator
  if (moderatorResponse.persona !== 'Moderator AI') {
    logger.error('🚨 CRITICAL BUG: moderatorResponse variable contains wrong persona!', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedPersona: 'Moderator AI',
      actualPersona: moderatorResponse.persona,
      actualTurn: moderatorResponse.turn,
      expectedTurn: expectedModeratorTurn,
      note: 'This indicates generateAIResponse returned wrong persona or variables are swapped',
    });
  }

  // CRITICAL: Verify Moderator response persona and turn immediately
  if (moderatorResponse.persona !== 'Moderator AI') {
    logger.error('🚨 CRITICAL: Moderator response has wrong persona immediately after generation', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedPersona: 'Moderator AI',
      actualPersona: moderatorResponse.persona,
    });
    throw new Error(`Moderator response persona mismatch: expected 'Moderator AI', got '${moderatorResponse.persona}'`);
  }

  // CRITICAL FIX 1.1: Validate turn number matches expected
  if (moderatorResponse.turn !== expectedModeratorTurn) {
    logger.error('🚨 CRITICAL: Moderator turn number mismatch', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedTurn: expectedModeratorTurn,
      actualTurn: moderatorResponse.turn,
    });
    throw new Error(`Moderator turn number mismatch: expected ${expectedModeratorTurn}, got ${moderatorResponse.turn}`);
  }

  // CRITICAL FIX: Validate response completeness - minimum length and proper punctuation
  const moderatorContent = moderatorResponse.content.trim();
  const moderatorMinLength = 800; // Minimum expected length (2-4 paragraphs)
  if (moderatorContent.length < moderatorMinLength) {
    logger.warn('⚠️ Moderator response is shorter than expected minimum length', {
      discussionId,
      roundNumber: currentRoundNumber,
      responseLength: moderatorContent.length,
      expectedMinLength: moderatorMinLength,
      difference: moderatorMinLength - moderatorContent.length,
      note: 'Response may be incomplete or truncated',
    });
  }
  if (!/[.!?]\s*$/.test(moderatorContent)) {
    logger.warn('⚠️ Moderator response does not end with proper punctuation', {
      discussionId,
      roundNumber: currentRoundNumber,
      responseLength: moderatorContent.length,
      lastChars: moderatorContent.slice(-50),
      note: 'Response may be incomplete',
    });
  }

  // CRITICAL: Validate all responses have correct turn numbers before creating round object
  const expectedAnalyzerTurnFinal = calculateTurnNumber(currentRoundNumber, 'Analyzer AI');
  const expectedSolverTurnFinal = calculateTurnNumber(currentRoundNumber, 'Solver AI');
  const expectedModeratorTurnFinal = calculateTurnNumber(currentRoundNumber, 'Moderator AI');

  // Validate Analyzer response
  if (analyzerResponse.persona !== 'Analyzer AI') {
    logger.error('🚨 CRITICAL: Analyzer response has wrong persona', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedPersona: 'Analyzer AI',
      actualPersona: analyzerResponse.persona,
    });
    throw new Error(`Analyzer response persona mismatch: expected 'Analyzer AI', got '${analyzerResponse.persona}'`);
  }
  if (analyzerResponse.turn !== expectedAnalyzerTurnFinal) {
    logger.error('🚨 CRITICAL: Analyzer response has wrong turn number in final round object', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedTurn: expectedAnalyzerTurnFinal,
      actualTurn: analyzerResponse.turn,
    });
    throw new Error(`Analyzer turn number mismatch in final round: expected ${expectedAnalyzerTurnFinal}, got ${analyzerResponse.turn}`);
  }

  // Validate Solver response
  if (solverResponse.persona !== 'Solver AI') {
    logger.error('🚨 CRITICAL: Solver response has wrong persona', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedPersona: 'Solver AI',
      actualPersona: solverResponse.persona,
    });
    throw new Error(`Solver response persona mismatch: expected 'Solver AI', got '${solverResponse.persona}'`);
  }
  if (solverResponse.turn !== expectedSolverTurnFinal) {
    logger.error('🚨 CRITICAL: Solver response has wrong turn number in final round object', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedTurn: expectedSolverTurnFinal,
      actualTurn: solverResponse.turn,
    });
    throw new Error(`Solver turn number mismatch in final round: expected ${expectedSolverTurnFinal}, got ${solverResponse.turn}`);
  }

  // Validate Moderator response
  if (moderatorResponse.persona !== 'Moderator AI') {
    logger.error('🚨 CRITICAL: Moderator response has wrong persona', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedPersona: 'Moderator AI',
      actualPersona: moderatorResponse.persona,
    });
    throw new Error(`Moderator response persona mismatch: expected 'Moderator AI', got '${moderatorResponse.persona}'`);
  }
  if (moderatorResponse.turn !== expectedModeratorTurnFinal) {
    logger.error('🚨 CRITICAL: Moderator response has wrong turn number in final round object', {
      discussionId,
      roundNumber: currentRoundNumber,
      expectedTurn: expectedModeratorTurnFinal,
      actualTurn: moderatorResponse.turn,
    });
    throw new Error(`Moderator turn number mismatch in final round: expected ${expectedModeratorTurnFinal}, got ${moderatorResponse.turn}`);
  }

  logger.info('✅ ROUND OBJECT VALIDATION: All responses validated before creating round object', {
    discussionId,
    roundNumber: currentRoundNumber,
    analyzerPersona: analyzerResponse.persona,
    analyzerTurn: analyzerResponse.turn,
    solverPersona: solverResponse.persona,
    solverTurn: solverResponse.turn,
    moderatorPersona: moderatorResponse.persona,
    moderatorTurn: moderatorResponse.turn,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL: Final validation before creating round object
  // Double-check that responses are in correct variables (defense against variable swapping bugs)
  if (analyzerResponse.persona !== 'Analyzer AI') {
    logger.error('🚨 CRITICAL BUG: analyzerResponse variable contains wrong persona!', {
      discussionId,
      roundNumber: currentRoundNumber,
      expected: 'Analyzer AI',
      actual: analyzerResponse.persona,
      actualTurn: analyzerResponse.turn,
    });
    throw new Error(`BUG DETECTED: analyzerResponse variable contains ${analyzerResponse.persona} instead of Analyzer AI`);
  }
  if (solverResponse.persona !== 'Solver AI') {
    logger.error('🚨 CRITICAL BUG: solverResponse variable contains wrong persona!', {
      discussionId,
      roundNumber: currentRoundNumber,
      expected: 'Solver AI',
      actual: solverResponse.persona,
      actualTurn: solverResponse.turn,
    });
    throw new Error(`BUG DETECTED: solverResponse variable contains ${solverResponse.persona} instead of Solver AI`);
  }
  if (moderatorResponse.persona !== 'Moderator AI') {
    logger.error('🚨 CRITICAL BUG: moderatorResponse variable contains wrong persona!', {
      discussionId,
      roundNumber: currentRoundNumber,
      expected: 'Moderator AI',
      actual: moderatorResponse.persona,
      actualTurn: moderatorResponse.turn,
    });
    throw new Error(`BUG DETECTED: moderatorResponse variable contains ${moderatorResponse.persona} instead of Moderator AI`);
  }

  // CRITICAL DEBUG: Log response variables before creating round object
  logger.info('🔍 DEBUG: Response variables before round object creation', {
    discussionId,
    roundNumber: currentRoundNumber,
    analyzerResponsePersona: analyzerResponse.persona,
    analyzerResponseTurn: analyzerResponse.turn,
    analyzerResponseLength: analyzerResponse.content.length,
    solverResponsePersona: solverResponse.persona,
    solverResponseTurn: solverResponse.turn,
    solverResponseLength: solverResponse.content.length,
    moderatorResponsePersona: moderatorResponse.persona,
    moderatorResponseTurn: moderatorResponse.turn,
    moderatorResponseLength: moderatorResponse.content.length,
    timestamp: new Date().toISOString(),
  });

  // Create round object with all three responses
  // CRITICAL: Ensure responses are assigned to correct fields
  // Order MUST be: Analyzer → Solver → Moderator
  const round: DiscussionRound = {
    roundNumber: currentRoundNumber,
    analyzerResponse, // Must be Analyzer AI with turn (roundNumber-1)*3+1
    solverResponse,   // Must be Solver AI with turn (roundNumber-1)*3+2
    moderatorResponse, // Must be Moderator AI with turn (roundNumber-1)*3+3
    timestamp: new Date().toISOString(),
  };

  // CRITICAL DEBUG: Verify round object after creation
  logger.info('🔍 DEBUG: Round object after creation - verifying assignments', {
    discussionId,
    roundNumber: currentRoundNumber,
    roundAnalyzerPersona: round.analyzerResponse.persona,
    roundAnalyzerTurn: round.analyzerResponse.turn,
    roundSolverPersona: round.solverResponse.persona,
    roundSolverTurn: round.solverResponse.turn,
    roundModeratorPersona: round.moderatorResponse.persona,
    roundModeratorTurn: round.moderatorResponse.turn,
    analyzerVariablePersona: analyzerResponse.persona,
    solverVariablePersona: solverResponse.persona,
    moderatorVariablePersona: moderatorResponse.persona,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL AUDIT: Validate round object matches execution order
  const roundPersonas = [
    round.analyzerResponse.persona,
    round.solverResponse.persona,
    round.moderatorResponse.persona,
  ];
  const roundOrderValidation = validateExecutionOrder(roundPersonas);
  if (!roundOrderValidation.isValid) {
    logger.error('🚨 CRITICAL: Round object personas do not match execution order!', {
      discussionId,
      roundNumber: currentRoundNumber,
      error: roundOrderValidation.error,
      roundPersonas,
      expectedOrder: EXECUTION_ORDER,
      note: 'This indicates responses were assigned to wrong properties in round object',
    });
    throw new Error(`Round object execution order validation failed: ${roundOrderValidation.error}`);
  }

  logger.info('✅ AUDIT: Round object execution order validated', {
    discussionId,
    roundNumber: currentRoundNumber,
    roundPersonas,
    expectedOrder: EXECUTION_ORDER,
    validated: true,
  });

  // CRITICAL: Log round object creation with full details for debugging
  logger.info('🔍 ROUND OBJECT CREATED: Final round object structure', {
    discussionId,
    roundNumber: currentRoundNumber,
    analyzerPersona: round.analyzerResponse.persona,
    analyzerTurn: round.analyzerResponse.turn,
    analyzerContentLength: round.analyzerResponse.content.length,
    solverPersona: round.solverResponse.persona,
    solverTurn: round.solverResponse.turn,
    solverContentLength: round.solverResponse.content.length,
    moderatorPersona: round.moderatorResponse.persona,
    moderatorTurn: round.moderatorResponse.turn,
    moderatorContentLength: round.moderatorResponse.content.length,
    timestamp: new Date().toISOString(),
  });

  // Final validation: Verify round object structure
  if (round.analyzerResponse.persona !== 'Analyzer AI' || round.analyzerResponse.turn !== expectedAnalyzerTurnFinal) {
    throw new Error(`Round object validation failed: Analyzer response incorrect`);
  }
  if (round.solverResponse.persona !== 'Solver AI' || round.solverResponse.turn !== expectedSolverTurnFinal) {
    throw new Error(`Round object validation failed: Solver response incorrect`);
  }
  if (round.moderatorResponse.persona !== 'Moderator AI' || round.moderatorResponse.turn !== expectedModeratorTurnFinal) {
    throw new Error(`Round object validation failed: Moderator response incorrect`);
  }

  logger.info('✅ ROUND OBJECT CREATED: Round object validated and ready to save', {
    discussionId,
    roundNumber: currentRoundNumber,
    timestamp: new Date().toISOString(),
  });

  return round;
}

/**
 * Check if auto-summary is needed and generate it if so
 */
async function checkAndGenerateAutoSummary(
  io: Server,
  discussionId: string,
  userId: string,
  discussionData: Awaited<ReturnType<typeof readDiscussion>>,
  discussionContext: Awaited<ReturnType<typeof loadDiscussionContext>>,
  round: DiscussionRound,
  currentRoundNumber: number
): Promise<void> {
  const lastSummaryRound = discussionContext.currentSummary?.roundNumber || 0;
  const roundsSinceLastSummary = currentRoundNumber - lastSummaryRound;
  const { getTokenLimit } = await import('@/lib/discussions/token-counter');
  const tokenLimit = getTokenLimit();
  const tokenThreshold = Math.floor(tokenLimit * 0.8);

  const needsAutoSummaryByToken = discussionContext.tokenCount >= tokenThreshold;
  const needsAutoSummaryByRounds = currentRoundNumber % 5 === 0 || roundsSinceLastSummary >= 5;
  const needsAutoSummary = needsAutoSummaryByToken || needsAutoSummaryByRounds;

  if (needsAutoSummary) {
    try {
      // Only summarize rounds that haven't been summarized yet
      // Include all rounds after the last summary, plus the current round
      const lastSummaryRound = discussionContext.currentSummary?.roundNumber || 0;
      const roundsToSummarize = (discussionData.rounds || []).filter(
        (r) => r.roundNumber > lastSummaryRound
      );
      const summaryEntry = await summarizeRounds(
        discussionId,
        userId,
        [...roundsToSummarize, round],
        currentRoundNumber
      );

      io.to(discussionId).emit('summary-created', {
        discussionId: discussionId,
        summary: summaryEntry,
      });

      logger.info('Auto-summary generated for round', {
        discussionId,
        roundNumber: currentRoundNumber,
        roundsSinceLastSummary,
        tokenCount: discussionContext.tokenCount,
        tokenLimit,
        triggeredByToken: needsAutoSummaryByToken,
        triggeredByRounds: needsAutoSummaryByRounds,
      });
    } catch (summaryError) {
      logger.error('Auto-summary generation failed, will retry on next trigger', {
        discussionId,
        roundNumber: currentRoundNumber,
        error: summaryError instanceof Error ? summaryError.message : String(summaryError),
      });
    }
  }
}

/**
 * Check if discussion is resolved and handle resolution
 */
async function checkAndHandleResolution(
  io: Server,
  discussionId: string,
  discussionData: Awaited<ReturnType<typeof readDiscussion>>,
  round: DiscussionRound,
  currentRoundNumber: number,
  topic: string
): Promise<boolean> {
  // Only check resolution after minimum rounds requirement
  const { DIALOGUE_CONFIG } = await import('@/lib/config');
  const minRounds = DIALOGUE_CONFIG.RESOLUTION_MIN_ROUNDS;

  if (currentRoundNumber < minRounds) {
    logger.debug('Skipping resolution check - below minimum rounds', {
      discussionId,
      currentRoundNumber,
      minRounds,
    });
    return false;
  }

  const allRounds = [...(discussionData.rounds || []), round];
  const allMessages = allRounds.flatMap((r) => [r.analyzerResponse, r.solverResponse, r.moderatorResponse]);

  if (allMessages.length >= minRounds * 3) {
    const resolutionResult = isResolved(allMessages, allRounds, topic);

    // STRICT REQUIREMENT: Only resolve if reason is 'consensus' (true multi-round consensus)
    if (resolutionResult.resolved && resolutionResult.reason === 'consensus') {
      logger.info('Discussion resolved with consensus - generating finalized summary', {
        discussionId,
        roundNumber: currentRoundNumber,
        confidence: resolutionResult.confidence,
        reason: resolutionResult.reason,
        hasSolution: !!resolutionResult.solution,
      });

      // Generate finalized summary (collaborative answer from all three LLMs)
      let finalizedSummary: string | undefined;
      try {
        const { generateFinalizedSummary } = await import('@/lib/llm/resolver');
        finalizedSummary = await generateFinalizedSummary(allRounds, topic, resolutionResult);
        logger.info('Finalized summary generated', {
          discussionId,
          summaryLength: finalizedSummary.length,
        });
      } catch (error) {
        logger.error('Error generating finalized summary', {
          discussionId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with resolution even if summary generation fails
      }

      // Store finalized summary in database (use summary field or add new field)
      const updateData: { is_resolved: number; summary?: string } = { is_resolved: 1 };
      if (finalizedSummary) {
        updateData.summary = finalizedSummary;
      }
      updateDiscussion(discussionId, updateData);

      // Emit resolution event with finalized summary
      io.to(discussionId).emit('conversation-resolved', {
        discussionId: discussionId,
        solution: resolutionResult.solution,
        confidence: resolutionResult.confidence,
        reason: resolutionResult.reason,
        finalizedSummary,
      });
      return true;
    } else if (resolutionResult.resolved && resolutionResult.reason !== 'consensus') {
      // Log that resolution was detected but not consensus - don't resolve
      logger.debug('Resolution detected but not consensus - continuing discussion', {
        discussionId,
        roundNumber: currentRoundNumber,
        reason: resolutionResult.reason,
        confidence: resolutionResult.confidence,
      });
    }
  }
  return false;
}

async function processDiscussionDialogueRounds(
  io: Server,
  _socket: Socket,
  discussionId: string,
  userId: string,
  topic: string,
  files: FileData[],
  discussion?: import('@/lib/db/discussions').Discussion
) {
  logger.info('processDiscussionDialogueRounds called', {
    discussionId,
    userId,
    hasDiscussion: !!discussion,
  });

  // Use provided discussion or look it up
  const discussionRecord = discussion || getDiscussion(discussionId, userId);
  if (!discussionRecord) {
    logger.error('Discussion not found in processDiscussionDialogueRounds', { discussionId });
    emitErrorToRoomWithDeduplication(
      io,
      discussionId,
      {
        code: ErrorCode.DISCUSSION_NOT_FOUND,
        message: 'Discussion not found. Please start a new dialogue.',
      },
      'process-dialogue-rounds'
    );
    return;
  }

  // Check if already resolved
  if (discussionRecord.is_resolved) {
    logger.info('Discussion already resolved, emitting resolved event', { discussionId });
    io.to(discussionId).emit('conversation-resolved', {
      discussionId: discussionId,
      confidence: 1.0,
      reason: 'already_resolved',
    });
    return;
  }

  // Acquire processing lock to prevent concurrent processing
  const { withProcessingLock } = await import('@/lib/discussions/processing-lock');
  try {
    await withProcessingLock(discussionId, userId, async () => {
      await processDiscussionDialogueRoundsInternal(
        io,
        _socket,
        discussionId,
        userId,
        topic,
        files
      );
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('already being processed')) {
      logger.warn('Discussion is already being processed', { discussionId, userId });
      emitErrorToRoomWithDeduplication(
        io,
        discussionId,
        {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Discussion is already being processed. Please wait for the current operation to complete.',
        },
        'process-dialogue-rounds'
      );
      return;
    }
    throw error;
  }
}

/**
 * Validate round state before processing
 * Checks round sequence and validates new round number
 */
function validateRoundState(
  discussionData: Awaited<ReturnType<typeof readDiscussion>>,
  discussionId: string,
  userId: string
): number {
  // CRITICAL: Validate round number sequence before processing
  if (discussionData.rounds && discussionData.rounds.length > 0) {
    const sequenceValidation = validateRoundNumberSequence(discussionData.rounds);
    if (!sequenceValidation.isValid) {
      logger.error('Round number sequence validation failed before processing', {
        discussionId,
        userId,
        errors: sequenceValidation.errors,
        roundsCount: discussionData.rounds.length,
      });
      // Log error but continue - may be recoverable
    }
  }

  // CRITICAL FIX: Calculate next round number from actual rounds array length, not from currentRound
  // ROOT CAUSE: currentRound could be stale or incorrect, causing wrong round numbers
  // Use rounds.length + 1 as the single source of truth for next round number
  const roundsCount = (discussionData.rounds || []).length;
  const currentRoundNumber = roundsCount + 1;

  // CRITICAL: Validate new round number matches expected value
  // This is now redundant since we calculate directly from rounds.length, but kept for safety
  const roundValidation = validateNewRoundNumber(discussionData.rounds || [], currentRoundNumber);
  if (!roundValidation.isValid) {
    logger.error('🚨 CRITICAL: Invalid round number - this should not happen', {
      discussionId,
      userId,
      calculatedRoundNumber: currentRoundNumber,
      expectedRoundNumber: roundsCount + 1,
      currentRound: discussionData.currentRound,
      roundsCount,
      error: roundValidation.error,
      note: 'Round number calculated from rounds.length + 1 should always match',
    });
    // Throw error to prevent processing with invalid round number
    throw new Error(roundValidation.error || 'Invalid round number');
  }

  // CRITICAL FIX: Log if currentRound is out of sync with actual rounds
  if (discussionData.currentRound !== roundsCount && roundsCount > 0) {
    logger.warn('⚠️ WARNING: currentRound is out of sync with actual rounds', {
      discussionId,
      userId,
      currentRound: discussionData.currentRound,
      roundsCount,
      calculatedRoundNumber: currentRoundNumber,
      note: 'Using rounds.length + 1 as source of truth',
    });
  }

  logger.info('✅ Round number calculated', {
    discussionId,
    userId,
    currentRoundNumber,
    roundsCount,
    currentRound: discussionData.currentRound,
    source: 'rounds.length + 1',
  });

  return currentRoundNumber;
}

/**
 * Collect user answers from previous rounds for context
 */
function collectUserAnswersFromRounds(
  discussionData: Awaited<ReturnType<typeof readDiscussion>>
): Record<string, string[]> {
  const userAnswers: Record<string, string[]> = {};
  if (discussionData.rounds) {
    discussionData.rounds.forEach((round) => {
      if (round.questions && round.userAnswers) {
        round.questions.questions.forEach((question) => {
          if (question.userAnswers && question.userAnswers.length > 0) {
            userAnswers[question.id] = question.userAnswers;
          }
        });
      }
    });
  }
  return userAnswers;
}

/**
 * Save round to storage and emit completion events
 */
async function saveRoundAndEmitEvents(
  io: Server,
  discussionId: string,
  userId: string,
  round: DiscussionRound,
  currentRoundNumber: number,
  topic?: string,
  discussionData?: Awaited<ReturnType<typeof readDiscussion>>
): Promise<void> {
  // Check if questions are needed BEFORE saving the round (for round 3)
  // This prevents duplicate saves and ensures questions are included in the round
  if (currentRoundNumber === 3 && topic && discussionData) {
    try {
      const { shouldGenerateQuestionsAfterRound3 } = await import('@/lib/llm/resolver');
      const allRounds = [...(discussionData.rounds || []), round];
      const shouldGenerate = shouldGenerateQuestionsAfterRound3(allRounds, topic);

      if (shouldGenerate) {
        logger.info('Auto-generating questions after round 3 - LLMs need clarification', {
          discussionId,
          roundNumber: currentRoundNumber,
        });

        // Load discussion context for question generation
        // loadDiscussionContext is already imported at the top of the file
        const discussionContext = await loadDiscussionContext(discussionId, userId);
        const previousRounds = discussionData.rounds || [];
        const currentSummary = discussionContext.currentSummary;

        // Generate questions automatically
        const { generateQuestions } = await import('@/lib/llm/question-generator');

        const questionSet = await generateQuestions(
          discussionId,
          userId,
          topic,
          round,
          currentSummary,
          previousRounds
        );

        // Store question set
        await addQuestionSetToDiscussion(discussionId, userId, questionSet);

        // Add questions to round object BEFORE saving
        round.questions = questionSet;

        logger.info('Questions generated and added to round', {
          discussionId,
          roundNumber: currentRoundNumber,
          questionCount: questionSet.questions.length,
        });
      } else {
        logger.debug('No questions needed after round 3 - LLMs are clear', {
          discussionId,
          roundNumber: currentRoundNumber,
        });
      }
    } catch (error) {
      logger.error('Error auto-generating questions after round 3', {
        discussionId,
        roundNumber: currentRoundNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't fail the round completion if question generation fails
      // Continue without questions
    }
  }

  // Save round to storage (with questions if they were generated)
  logger.debug('Saving round to storage', { discussionId, roundNumber: currentRoundNumber });
  await syncFileAndDatabase(
    () => addRoundToDiscussion(discussionId, userId, round),
    () =>
      updateDiscussion(discussionId, {
        current_turn: currentRoundNumber * 3, // Each round = 3 turns (analyzer, solver, moderator)
        updated_at: Date.now(),
      }),
    { discussionId, userId, operation: 'addRound' }
  );
  logger.debug('Round saved to storage', { discussionId, roundNumber: currentRoundNumber });

  // Emit round complete event (with questions if they were generated)
  logger.info('Emitting round-complete event', { discussionId, roundNumber: currentRoundNumber });
  io.to(discussionId).emit('round-complete', {
    discussionId: discussionId,
    round,
    currentRoundNumber: currentRoundNumber,
  });

  // Emit questions generated event if questions were added
  if (round.questions) {
    io.to(discussionId).emit('questions-generated', {
      discussionId: discussionId,
      questionSet: round.questions,
      roundNumber: currentRoundNumber,
    });
  }

  logger.info('Round completed successfully', {
    discussionId,
    roundNumber: currentRoundNumber,
    solverLength: round.solverResponse.content.length,
    analyzerLength: round.analyzerResponse.content.length,
    moderatorLength: round.moderatorResponse.content.length,
    hasQuestions: !!round.questions,
  });
}

/**
 * Handle errors during round processing
 * Determines if error is recoverable and handles cleanup
 */
function handleRoundProcessingError(
  error: unknown,
  io: Server,
  discussionId: string,
  userId: string,
  partialStateCreated: boolean
): never {
  // Error recovery: clean up partial state
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  logger.error('Error processing round, cleaning up partial state', {
    discussionId,
    userId,
    error: errorMessage,
    errorStack,
    partialStateCreated,
  });

  // Determine if error is recoverable or permanent
  const isRecoverableError =
    errorMessage.includes('rate limit') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('network') ||
    errorMessage.includes('temporary');

  // Mark discussion as resolved if error is permanent or discussion is in bad state
  // This allows user to start a new discussion
  if (!isRecoverableError || partialStateCreated) {
    try {
      // Mark as resolved so user can start a new discussion
      updateDiscussion(discussionId, { is_resolved: 1 });
      logger.warn('Discussion marked as resolved due to error', {
        discussionId,
        userId,
        reason: isRecoverableError ? 'partial_state' : 'permanent_error',
        error: errorMessage,
      });
    } catch (cleanupError) {
      logger.error('Failed to mark discussion as resolved during cleanup', {
        discussionId,
        userId,
        cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
  }

  // Emit error to client with more context
  const userFriendlyMessage = isRecoverableError
    ? 'A temporary error occurred. You can try starting a new discussion.'
    : 'An error occurred while processing the discussion. The discussion has been marked as resolved. You can start a new discussion.';

  emitErrorToRoomWithDeduplication(
    io,
    discussionId,
    {
      code: ErrorCode.INTERNAL_ERROR,
      message: userFriendlyMessage,
      recoverable: isRecoverableError,
    },
    'process-round'
  );

  // Re-throw to be caught by outer handler
  throw error;
}

async function processDiscussionDialogueRoundsInternal(
  io: Server,
  _socket: Socket,
  discussionId: string,
  userId: string,
  topic: string,
  files: FileData[]
) {
  const partialStateCreated = false;

  try {
    // Load discussion data and context
    const { discussionData, discussionContext } = await loadDiscussionDataAndContext(
      io,
      discussionId,
      userId
    );

    // Validate round state and get current round number
    const currentRoundNumber = validateRoundState(discussionData, discussionId, userId);

    const maxRounds = Math.floor(MAX_TURNS / 3); // Each round has 3 AI responses

    logger.info('Processing round', {
      discussionId,
      currentRoundNumber,
      maxRounds,
      previousRound: discussionData.currentRound,
    });

    if (currentRoundNumber > maxRounds) {
      logger.info('Discussion reached max rounds', { discussionId, currentRoundNumber, maxRounds });
      // Extract solution from last complete round if available
      const allRounds = discussionData.rounds || [];
      const allMessages = allRounds.flatMap((r) => [r.analyzerResponse, r.solverResponse, r.moderatorResponse]);
      // Call isResolved to extract solution (it will return resolved: true due to max turns)
      const resolutionResult = isResolved(allMessages, allRounds, topic);
      io.to(discussionId).emit('conversation-resolved', {
        discussionId: discussionId,
        solution: resolutionResult.solution,
        confidence: resolutionResult.confidence,
        reason: resolutionResult.reason || 'max_turns',
      });
      updateDiscussion(discussionId, { is_resolved: 1 });
      return;
    }

    const isFirstRound = currentRoundNumber === 1;

    // Collect user answers from previous rounds for context
    const userAnswers = collectUserAnswersFromRounds(discussionData);

    try {
      // Process the round: generate all three AI responses
      const round = await processSingleRound(
        io,
        discussionId,
        topic,
        discussionContext,
        isFirstRound,
        files,
        currentRoundNumber,
        userAnswers
      );

      // Save round and emit events (with topic and discussionData for auto-question generation)
      await saveRoundAndEmitEvents(io, discussionId, userId, round, currentRoundNumber, topic, discussionData);

      // Check and generate auto-summary if needed
      await checkAndGenerateAutoSummary(
        io,
        discussionId,
        userId,
        discussionData,
        discussionContext,
        round,
        currentRoundNumber
      );

      // Check for resolution
      if (await checkAndHandleResolution(io, discussionId, discussionData, round, currentRoundNumber, topic)) {
        return; // Discussion resolved, exit early
      }
    } catch (error) {
      handleRoundProcessingError(error, io, discussionId, userId, partialStateCreated);
    }
  } catch (outerError) {
    // Catch any errors from outer try block (loading data, context, etc.)
    const errorMessage = outerError instanceof Error ? outerError.message : String(outerError);
    const errorStack = outerError instanceof Error ? outerError.stack : undefined;

    logger.error('Error in processDiscussionDialogueRoundsInternal (outer catch)', {
      discussionId,
      userId,
      error: errorMessage,
      errorStack,
    });

    // Mark discussion as resolved on outer errors to allow recovery
    try {
      const discussionRecord = getDiscussion(discussionId, userId);
      if (discussionRecord && !discussionRecord.is_resolved) {
        updateDiscussion(discussionId, { is_resolved: 1 });
        logger.warn('Discussion marked as resolved due to outer error', {
          discussionId,
          userId,
          error: errorMessage,
        });
      }
    } catch (cleanupError) {
      logger.error('Failed to mark discussion as resolved during outer error cleanup', {
        discussionId,
        userId,
        cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }

    emitErrorToRoomWithDeduplication(
      io,
      discussionId,
      {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An error occurred while processing the discussion. The discussion has been marked as resolved. You can start a new discussion.',
        recoverable: false,
      },
      'process-dialogue-rounds-internal'
    );

    throw outerError;
  }
}

/**
 * Helper function to generate AI response for a round
 * Exported for use by round orchestrator
 */
export async function generateAIResponse(
  io: Server,
  discussionId: string,
  persona: typeof aiPersonas.solver | typeof aiPersonas.analyzer | typeof aiPersonas.moderator,
  topic: string,
  discussionContext: Awaited<ReturnType<typeof loadDiscussionContext>>,
  isFirstMessage: boolean,
  files: FileData[] | undefined,
  roundNumber: number,
  userAnswers: Record<string, string[]>
): Promise<import('@/types').ConversationMessage> {
  // CRITICAL FIX 1.1: Pre-execution validation
  // Calculate expected turn BEFORE any processing
  const expectedTurn = calculateTurnNumber(roundNumber, persona.name as 'Analyzer AI' | 'Solver AI' | 'Moderator AI');

  // Get last message persona for order validation
  const rounds = discussionContext.rounds || [];
  const allMessages = discussionContext.messages || [];
  let lastMessagePersona: string | null = null;

  // Find last message persona from rounds (preferred) or messages (legacy)
  // CRITICAL: For Analyzer starting a new round, only look at COMPLETE rounds
  // This ensures Analyzer never sees Solver's response from an incomplete round
  if (rounds.length > 0) {
    // ROOT CAUSE FIX: For Analyzer, use simplified logic - ALWAYS use Moderator from last complete round
    if (persona.name === 'Analyzer AI') {
      // For Analyzer, ONLY look at complete rounds
      const completeRounds = filterCompleteRounds(rounds);

      if (completeRounds.length > 0) {
        // Analyzer should respond to Moderator from the last complete round
        const lastCompleteRound = completeRounds[completeRounds.length - 1];
        if (lastCompleteRound.moderatorResponse?.content?.trim()) {
          lastMessagePersona = lastCompleteRound.moderatorResponse.persona;
          logger.info('✅ ROOT CAUSE FIX: Analyzer lastMessagePersona set to Moderator from last complete round', {
            discussionId,
            persona: persona.name,
            roundNumber,
            lastCompleteRoundNumber: lastCompleteRound.roundNumber,
            lastMessagePersona,
            moderatorContentLength: lastCompleteRound.moderatorResponse.content.trim().length,
            note: 'Analyzer correctly responding to Moderator from previous complete round',
          });
        } else {
          // This should never happen if filterCompleteRounds works correctly
          logger.error('🚨 CRITICAL BUG: Last complete round missing Moderator response!', {
            discussionId,
            persona: persona.name,
            roundNumber,
            lastCompleteRoundNumber: lastCompleteRound.roundNumber,
            hasModerator: !!lastCompleteRound.moderatorResponse?.content?.trim(),
            hasSolver: !!lastCompleteRound.solverResponse?.content?.trim(),
            hasAnalyzer: !!lastCompleteRound.analyzerResponse?.content?.trim(),
          });
          lastMessagePersona = null;
        }
      } else {
        // No complete rounds - this is Round 1 or all rounds are incomplete
        lastMessagePersona = null;
        logger.info('✅ ROOT CAUSE FIX: Analyzer lastMessagePersona set to null (no complete rounds - Round 1)', {
          discussionId,
          persona: persona.name,
          roundNumber,
          totalRoundsCount: rounds.length,
          completeRoundsCount: 0,
        });
      }
    } else {
      // For Solver and Moderator, use the existing complex logic
      let roundsToCheck = rounds;

      // Find the last round
      let lastRound = roundsToCheck[roundsToCheck.length - 1];

      if (lastRound) {
        // Log round state for debugging
        logger.debug('🔍 Determining lastMessagePersona from rounds', {
          discussionId,
          persona: persona.name,
          roundNumber,
          lastRoundNumber: lastRound.roundNumber,
          hasModerator: !!lastRound.moderatorResponse?.content?.trim(),
          hasSolver: !!lastRound.solverResponse?.content?.trim(),
          hasAnalyzer: !!lastRound.analyzerResponse?.content?.trim(),
          moderatorPersona: lastRound.moderatorResponse?.persona,
          solverPersona: lastRound.solverResponse?.persona,
          analyzerPersona: lastRound.analyzerResponse?.persona,
          isCompleteRound: !!lastRound.moderatorResponse?.content?.trim() &&
                           !!lastRound.solverResponse?.content?.trim() &&
                           !!lastRound.analyzerResponse?.content?.trim(),
        });

        // CRITICAL: Check in order: Moderator (last in round) → Solver → Analyzer (first in round)
        // Only use responses with actual content (not placeholders)
        if (lastRound.moderatorResponse?.content?.trim()) {
          lastMessagePersona = lastRound.moderatorResponse.persona;
          logger.debug('🔍 lastMessagePersona = Moderator (from lastRound.moderatorResponse)', {
            discussionId,
            persona: persona.name,
            lastMessagePersona,
            contentLength: lastRound.moderatorResponse.content.trim().length,
          });
        } else if (lastRound.solverResponse?.content?.trim()) {
          // For Solver AI
          if (persona.name === 'Solver AI') {
            // CRITICAL FIX: Solver should NEVER see its own response from a previous round
            // If we see Solver's response and it's not the current round, this is an error
            if (lastRound.roundNumber !== roundNumber) {
              logger.error('🚨 CRITICAL BUG: Solver seeing its own response from previous round!', {
                discussionId,
                persona: persona.name,
                roundNumber,
                lastRoundNumber: lastRound.roundNumber,
                error: 'Solver should only see Analyzer responses, not its own from previous rounds',
              });
              // Force lastMessagePersona to Analyzer AI (expected before Solver)
              lastMessagePersona = 'Analyzer AI';
            } else {
              // This is the current round being processed - Solver should see Analyzer's response
              // If we're seeing Solver's response here, it means Analyzer hasn't responded yet
              // This should not happen, but if it does, force to Analyzer
              if (lastRound.analyzerResponse?.content?.trim()) {
                lastMessagePersona = lastRound.analyzerResponse.persona;
                logger.debug('🔍 lastMessagePersona = Analyzer (from current round, Solver should follow)', {
                  discussionId,
                  persona: persona.name,
                  lastMessagePersona,
                  roundNumber: lastRound.roundNumber,
                });
              } else {
                logger.error('🚨 CRITICAL BUG: Solver being called but Analyzer response missing!', {
                  discussionId,
                  persona: persona.name,
                  roundNumber,
                  lastRoundNumber: lastRound.roundNumber,
                  error: 'Solver cannot execute before Analyzer completes',
                });
                // Force to null to trigger error in validation
                lastMessagePersona = null;
              }
            }
          } else {
            // For Moderator, this is acceptable (incomplete round in current round)
            const solverContent = lastRound.solverResponse.content.trim();
            if (solverContent.length > 0) {
              lastMessagePersona = lastRound.solverResponse.persona;
              logger.debug('🔍 lastMessagePersona = Solver (from lastRound.solverResponse)', {
                discussionId,
                persona: persona.name,
                lastMessagePersona,
                contentLength: solverContent.length,
                warning: 'Round may be incomplete - Solver response exists but Moderator does not',
              });
            }
          }
        } else if (lastRound.analyzerResponse?.content?.trim()) {
          // For Solver/Moderator, this might happen in edge cases
          const analyzerContent = lastRound.analyzerResponse.content.trim();
          if (analyzerContent.length > 0) {
            lastMessagePersona = lastRound.analyzerResponse.persona;
            logger.debug('🔍 lastMessagePersona = Analyzer (from lastRound.analyzerResponse)', {
              discussionId,
              persona: persona.name,
              lastMessagePersona,
              contentLength: analyzerContent.length,
              warning: 'Round may be incomplete - only Analyzer response exists',
            });
          }
        }

        // If we still don't have a lastMessagePersona, log it
        if (!lastMessagePersona) {
          logger.debug('🔍 No content in lastRound, lastMessagePersona remains null', {
            discussionId,
            persona: persona.name,
            lastRoundNumber: lastRound.roundNumber,
            hasModerator: !!lastRound.moderatorResponse,
            hasSolver: !!lastRound.solverResponse,
            hasAnalyzer: !!lastRound.analyzerResponse,
            moderatorContentLength: lastRound.moderatorResponse?.content?.trim().length || 0,
            solverContentLength: lastRound.solverResponse?.content?.trim().length || 0,
            analyzerContentLength: lastRound.analyzerResponse?.content?.trim().length || 0,
          });
        }
      }
    }
  } else if (allMessages.length > 0) {
    lastMessagePersona = allMessages[allMessages.length - 1].persona;
    logger.debug('🔍 lastMessagePersona from legacy messages', {
      discussionId,
      persona: persona.name,
      lastMessagePersona,
      messagesCount: allMessages.length,
    });
  } else {
    logger.debug('🔍 No previous messages, lastMessagePersona is null', {
      discussionId,
      persona: persona.name,
      roundNumber,
    });
  }

  // CRITICAL VALIDATION: Analyzer must NEVER have lastMessagePersona = 'Solver AI'
  if (persona.name === 'Analyzer AI' && lastMessagePersona === 'Solver AI') {
    logger.error('🚨 CRITICAL BUG: Analyzer has lastMessagePersona = Solver AI - this should NEVER happen!', {
      discussionId,
      persona: persona.name,
      roundNumber,
      lastMessagePersona,
      roundsCount: rounds.length,
      completeRoundsCount: filterCompleteRounds(rounds).length,
      error: 'Analyzer should respond to Moderator or null, never to Solver',
    });
    // Force to null or find Moderator from complete rounds
    const completeRounds = filterCompleteRounds(rounds);
    if (completeRounds.length > 0) {
      const lastCompleteRound = completeRounds[completeRounds.length - 1];
      if (lastCompleteRound.moderatorResponse?.content?.trim()) {
        lastMessagePersona = lastCompleteRound.moderatorResponse.persona;
        logger.error('🔧 ROOT CAUSE FIX: Corrected Analyzer lastMessagePersona to Moderator', {
          discussionId,
          persona: persona.name,
          roundNumber,
          correctedLastMessagePersona: lastMessagePersona,
          lastCompleteRoundNumber: lastCompleteRound.roundNumber,
        });
      } else {
        lastMessagePersona = null;
        logger.error('🔧 ROOT CAUSE FIX: Corrected Analyzer lastMessagePersona to null (no Moderator found)', {
          discussionId,
          persona: persona.name,
          roundNumber,
        });
      }
    } else {
      lastMessagePersona = null;
      logger.error('🔧 ROOT CAUSE FIX: Corrected Analyzer lastMessagePersona to null (no complete rounds)', {
        discussionId,
        persona: persona.name,
        roundNumber,
      });
    }
  }

  // CRITICAL: Log persona details before validation
  logger.info('🔍 PERSONA ORDER VALIDATION: Pre-validation check', {
    discussionId,
    currentPersona: persona.name,
    currentPersonaId: persona.id,
    currentPersonaProvider: persona.provider,
    roundNumber,
    expectedTurn,
    lastMessagePersona,
    isFirstMessage,
    roundsCount: rounds.length,
    messagesCount: allMessages.length,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL FIX: Additional explicit validation before calling validatePersonaOrder
  // For Solver: Must have Analyzer response from current round
  if (persona.name === 'Solver AI' && !isFirstMessage) {
    const currentRound = rounds.find((r) => r.roundNumber === roundNumber);
    if (!currentRound || !currentRound.analyzerResponse?.content?.trim()) {
      logger.error('🚨 CRITICAL: Solver cannot execute - Analyzer response missing from current round', {
        discussionId,
        persona: persona.name,
        roundNumber,
        hasCurrentRound: !!currentRound,
        hasAnalyzerResponse: !!currentRound?.analyzerResponse?.content?.trim(),
        lastMessagePersona,
      });
      throw new Error('Solver cannot execute before Analyzer completes in the current round');
    }
    // Ensure lastMessagePersona is Analyzer AI for Solver
    if (lastMessagePersona !== 'Analyzer AI') {
      logger.warn('🚨 CRITICAL FIX: Forcing lastMessagePersona to Analyzer AI for Solver', {
        discussionId,
        persona: persona.name,
        roundNumber,
        originalLastMessagePersona: lastMessagePersona,
        correctedLastMessagePersona: 'Analyzer AI',
      });
      lastMessagePersona = 'Analyzer AI';
    }
  }

  // For Moderator: Must have both Analyzer and Solver responses from current round
  if (persona.name === 'Moderator AI' && !isFirstMessage) {
    const currentRound = rounds.find((r) => r.roundNumber === roundNumber);
    if (!currentRound || !currentRound.analyzerResponse?.content?.trim() || !currentRound.solverResponse?.content?.trim()) {
      logger.error('🚨 CRITICAL: Moderator cannot execute - Analyzer or Solver response missing from current round', {
        discussionId,
        persona: persona.name,
        roundNumber,
        hasCurrentRound: !!currentRound,
        hasAnalyzerResponse: !!currentRound?.analyzerResponse?.content?.trim(),
        hasSolverResponse: !!currentRound?.solverResponse?.content?.trim(),
        lastMessagePersona,
      });
      throw new Error('Moderator cannot execute before both Analyzer and Solver complete in the current round');
    }
    // Ensure lastMessagePersona is Solver AI for Moderator
    if (lastMessagePersona !== 'Solver AI') {
      logger.warn('🚨 CRITICAL FIX: Forcing lastMessagePersona to Solver AI for Moderator', {
        discussionId,
        persona: persona.name,
        roundNumber,
        originalLastMessagePersona: lastMessagePersona,
        correctedLastMessagePersona: 'Solver AI',
      });
      lastMessagePersona = 'Solver AI';
    }
  }

  // Validate persona execution order
  const orderValidation = validatePersonaOrder(persona.name, lastMessagePersona, isFirstMessage);
  if (!orderValidation.isValid) {
    logger.error('🚨 CRITICAL: Persona execution order validation failed', {
      discussionId,
      persona: persona.name,
      personaId: persona.id,
      roundNumber,
      expectedTurn,
      lastMessagePersona,
      isFirstMessage,
      error: orderValidation.message,
      roundsCount: rounds.length,
      lastRoundDetails: rounds.length > 0 ? {
        roundNumber: rounds[rounds.length - 1].roundNumber,
        hasModerator: !!rounds[rounds.length - 1].moderatorResponse?.content?.trim(),
        hasSolver: !!rounds[rounds.length - 1].solverResponse?.content?.trim(),
        hasAnalyzer: !!rounds[rounds.length - 1].analyzerResponse?.content?.trim(),
      } : null,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Persona execution order validation failed: ${orderValidation.message}`);
  }

  logger.info('✅ EXECUTION ORDER: Pre-execution validation passed', {
    discussionId,
    persona: persona.name,
    roundNumber,
    expectedTurn,
    lastMessagePersona,
    isFirstMessage,
    validationMessage: orderValidation.message,
    timestamp: new Date().toISOString(),
  });

  // Build messages for LLM
  const llmMessages: LLMMessage[] = [{ role: 'system', content: persona.systemPrompt }];

  // CRITICAL FIX: Pre-filter rounds before passing to formatLLMPrompt
  // This ensures consistent filtering and prevents context contamination
  const filteredRounds = filterRoundsForPersona(
    rounds,
    persona.name as 'Analyzer AI' | 'Solver AI' | 'Moderator AI',
    roundNumber
  );

  if (filteredRounds.length !== rounds.length) {
    logger.info('🔍 Pre-filtering rounds for formatLLMPrompt', {
      discussionId,
      persona: persona.name,
      roundNumber,
      originalRoundsCount: rounds.length,
      filteredRoundsCount: filteredRounds.length,
      filteredOut: rounds.length - filteredRounds.length,
    });
  }

  // Format conversation context
  // Use rounds if available (new structure), fallback to messages (legacy)
  const isFirstMessageForPrompt = isFirstMessage && filteredRounds.length === 0 && allMessages.length === 0;

  // CRITICAL VALIDATION: Before calling formatLLMPrompt, verify Analyzer's lastMessagePersona is correct
  if (persona.name === 'Analyzer AI' && lastMessagePersona === 'Solver AI') {
    logger.error('🚨 CRITICAL BUG: Analyzer has lastMessagePersona = Solver AI before formatLLMPrompt!', {
      discussionId,
      persona: persona.name,
      roundNumber,
      lastMessagePersona,
      filteredRoundsCount: filteredRounds.length,
      completeRoundsCount: filterCompleteRounds(filteredRounds).length,
      error: 'This should have been caught earlier - Analyzer must respond to Moderator or null',
    });
    throw new Error('CRITICAL: Analyzer cannot have lastMessagePersona = Solver AI');
  }

  const userPrompt = formatLLMPrompt(
    topic,
    allMessages,
    isFirstMessageForPrompt,
    persona.name as 'Solver AI' | 'Analyzer AI' | 'Moderator AI',
    isFirstMessageForPrompt ? files : undefined,
    discussionContext.summary, // Legacy
    filteredRounds, // CRITICAL FIX: Use pre-filtered rounds instead of full rounds array
    discussionContext.currentSummary, // New
    discussionContext.summaries, // New: all summaries
    userAnswers, // New
    roundNumber // New: current round number
  );

  // CRITICAL VALIDATION: After formatLLMPrompt, verify the prompt doesn't indicate Analyzer should respond to Solver
  // Check if the prompt contains text suggesting Analyzer should respond to Solver
  if (persona.name === 'Analyzer AI') {
    const promptLower = userPrompt.toLowerCase();
    const hasSolverReference = promptLower.includes('solver ai') &&
      (promptLower.includes('respond to solver') ||
       promptLower.includes('solver said') ||
       promptLower.includes('solver\'s response') ||
       promptLower.includes('solver responded'));

    if (hasSolverReference && lastMessagePersona === 'Solver AI') {
      logger.error('🚨 CRITICAL BUG: Prompt indicates Analyzer should respond to Solver!', {
        discussionId,
        persona: persona.name,
        roundNumber,
        lastMessagePersona,
        promptPreview: userPrompt.substring(0, 500),
        error: 'Prompt should indicate Analyzer responds to Moderator, not Solver',
      });
      throw new Error('CRITICAL: Prompt indicates Analyzer should respond to Solver');
    }
  }

  logger.debug('Generated prompt for AI response', {
    discussionId,
    persona: persona.name,
    roundNumber,
    isFirstMessage: isFirstMessageForPrompt,
    promptLength: userPrompt.length,
    roundsCount: filteredRounds.length, // Use filtered rounds count
    originalRoundsCount: rounds.length,
    messagesCount: allMessages.length,
  });

  llmMessages.push({
    role: 'user',
    content: userPrompt,
    files: isFirstMessage ? files : undefined,
  });

  // PHASE 1: DIAGNOSTIC LOGGING - Context Token Usage
  const { countTokens, estimateTokensFromChars } = await import('@/lib/discussions/token-counter');
  const { LLM_CONFIG: LLM_CONFIG_FOR_LOGGING } = await import('@/lib/config');
  const systemPromptTokens = countTokens(persona.systemPrompt);
  const userPromptTokens = countTokens(userPrompt);
  const totalInputTokens = systemPromptTokens + userPromptTokens;
  const maxTokensForResponse = LLM_CONFIG_FOR_LOGGING.DEFAULT_MAX_TOKENS;
  // Note: max_tokens is output tokens, not total context
  const contextTokenPercentage = totalInputTokens > 0 ? ((totalInputTokens / (totalInputTokens + maxTokensForResponse)) * 100).toFixed(1) : '0';

  logger.info('📊 TOKEN USAGE: Context and input token analysis', {
    discussionId,
    persona: persona.name,
    roundNumber,
    systemPromptTokens,
    userPromptTokens,
    totalInputTokens,
    maxTokens: maxTokensForResponse,
    availableTokensForResponse: maxTokensForResponse, // max_tokens is output tokens, not total context
    contextTokenPercentage: `${contextTokenPercentage}%`,
    systemPromptLength: persona.systemPrompt.length,
    userPromptLength: userPrompt.length,
    filteredRoundsCount: filteredRounds.length,
    allMessagesCount: allMessages.length,
    hasSummary: !!discussionContext.currentSummary,
    timestamp: new Date().toISOString(),
  });

  // Get LLM provider with error handling
  let provider: LLMProvider;
  try {
    provider = getProviderWithFallback(persona.provider);
  } catch (providerError) {
    logger.error('Failed to get LLM provider', {
      discussionId,
      persona: persona.name,
      roundNumber,
      error: providerError instanceof Error ? providerError.message : String(providerError),
    });

    // Emit error to client
    emitErrorToRoomWithDeduplication(
      io,
      discussionId,
      {
        code: ErrorCode.LLM_PROVIDER_ERROR,
        message:
          providerError instanceof Error
            ? providerError.message
            : 'No LLM providers are available. Please check your API key configuration.',
      },
      'generate-ai-response'
    );

    // Re-throw to be caught by outer error handler
    throw providerError;
  }

  // Emit message start
  // CRITICAL FIX 1.1: Use expectedTurn calculated at function start (already validated)
  const turn = expectedTurn;

  // CRITICAL VALIDATION: Final check before LLM call - Analyzer must never have lastMessagePersona = Solver
  if (persona.name === 'Analyzer AI' && lastMessagePersona === 'Solver AI') {
    logger.error('🚨 CRITICAL BUG: Analyzer lastMessagePersona is Solver AI before LLM call!', {
      discussionId,
      persona: persona.name,
      roundNumber,
      lastMessagePersona,
      turn,
      expectedTurn,
      filteredRoundsCount: filteredRounds.length,
      error: 'This is a critical bug - Analyzer must respond to Moderator or null, never to Solver',
    });
    throw new Error('CRITICAL: Analyzer cannot have lastMessagePersona = Solver AI before LLM call');
  }

  logger.info('🚀 EXECUTING: Starting message generation', {
    discussionId,
    persona: persona.name,
    personaId: persona.id,
    round: roundNumber,
    turn,
    expectedTurn,
    exchangeNumber: turn, // Turn number equals exchange number
    isFirstMessage,
    lastMessagePersona,
    contextRoundsCount: discussionContext.rounds?.length || 0,
    contextMessagesCount: discussionContext.messages?.length || 0,
    filteredRoundsCount: filteredRounds.length,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL DEBUG: Log message-start emission with full details
  logger.info('🔍 DEBUG: Emitting message-start event', {
    discussionId,
    persona: persona.name,
    personaId: persona.id,
    turn,
    expectedTurn,
    roundNumber,
    timestamp: new Date().toISOString(),
  });

  io.to(discussionId).emit('message-start', {
    discussionId: discussionId,
    persona: persona.name,
    turn,
  });

    // CRITICAL FIX 1.2: Stream response with proper chunk accumulation
    //
    // Variable Usage Pattern:
    // - fullResponse: Accumulates chunks during streaming for real-time UI display
    // - finalResponse: Source of truth from provider (may include continuation chunks not emitted)
    // - After streaming: fullResponse is set to finalResponse to ensure consistency
    // - Final message uses fullResponse (which equals finalResponse) - only whitespace is trimmed
    //
    // This pattern ensures:
    // 1. Real-time streaming works correctly (chunks emitted as received)
    // 2. Complete responses are stored (using finalResponse as source of truth)
    // 3. Continuation chunks are captured even if not properly emitted during streaming
    //
    // NOTE: With BaseProvider refactoring, completion logic now ensures continuation chunks
    // are always emitted via onChunk callback. This code handles edge cases where chunks
    // might still be missing.
    let fullResponse = '';
    let finalResponse = '';
    let chunkCount = 0;
    let continuationChunkCount = 0;
    let initialStreamingComplete = false;
    let lastChunkTime = Date.now();
  try {
    // provider.stream() returns the final response (which may have been completed via completeThought)
    // The onChunk callback will be called for both initial chunks and continuation chunks
    finalResponse = await provider.stream(llmMessages, (chunk: string) => {
      if (typeof chunk !== 'string') {
        logger.warn('Received non-string chunk from LLM provider', {
          persona: persona.name,
          discussionId,
        });
        return;
      }
      // CRITICAL FIX 1.2: Accumulate chunks for real-time display only
      fullResponse += chunk;
      chunkCount++;

      // ENHANCED: Track continuation chunks more accurately
      // Continuation chunks typically come after a pause in streaming
      const timeSinceLastChunk = Date.now() - lastChunkTime;
      lastChunkTime = Date.now();

      if (initialStreamingComplete) {
        continuationChunkCount++;
        logger.info('📦 Received continuation chunk', {
          persona: persona.name,
          discussionId,
          roundNumber,
          chunkNumber: chunkCount,
          continuationChunkNumber: continuationChunkCount,
          chunkLength: chunk.length,
          accumulatedLength: fullResponse.length,
          timeSinceLastChunk,
        });
      } else if (timeSinceLastChunk > 1000 && chunkCount > 10) {
        // Detect potential gap in initial streaming (pause > 1 second)
        logger.debug('Potential pause in initial streaming detected', {
          persona: persona.name,
          discussionId,
          roundNumber,
          chunkNumber: chunkCount,
          timeSinceLastChunk,
          accumulatedLength: fullResponse.length,
        });
      }
      // Emit chunk in real-time
      io.to(discussionId).emit('message-chunk', {
        discussionId: discussionId,
        chunk,
      });
    });

    // Mark initial streaming as complete
    initialStreamingComplete = true;

    // PHASE 1: DIAGNOSTIC LOGGING - Response Metrics
    const responseTokens = countTokens(fullResponse);
    const finalResponseTokens = countTokens(finalResponse);
    // Use standardized token estimation for consistency
    const estimatedResponseTokens = estimateTokensFromChars(fullResponse.trim().length);

    logger.info('📊 RESPONSE METRICS: Streaming completed - comprehensive analysis', {
      discussionId,
      persona: persona.name,
      roundNumber,
      // Chunk metrics
      chunkCount,
      continuationChunkCount,
      // Length metrics
      accumulatedLength: fullResponse.length,
      finalResponseLength: finalResponse.length,
      lengthDifference: finalResponse.length - fullResponse.length,
      // Token metrics
      responseTokens,
      finalResponseTokens,
      estimatedResponseTokens,
      maxTokens: maxTokensForResponse,
      tokenUtilization: maxTokensForResponse ? `${((estimatedResponseTokens / maxTokensForResponse) * 100).toFixed(1)}%` : 'N/A',
      // Content analysis
      endsWithPunctuation: /[.!?]\s*$/.test(fullResponse.trim()),
      lastChars: fullResponse.trim().slice(-100),
      // Context comparison
      totalInputTokens,
      totalOutputTokens: estimatedResponseTokens,
      totalTokensUsed: totalInputTokens + estimatedResponseTokens,
      timestamp: new Date().toISOString(),
    });

    // CRITICAL FIX 1.2: Use finalResponse as source of truth
    // Validate lengths match within tolerance (10% for trimming differences)
    const lengthMismatch = Math.abs(finalResponse.length - fullResponse.length);
    const tolerance = Math.max(10, Math.floor(finalResponse.length * 0.1)); // 10% or 10 chars, whichever is larger

    if (lengthMismatch > tolerance) {
      logger.warn('⚠️ Chunk accumulation length mismatch detected', {
        discussionId,
        persona: persona.name,
        roundNumber,
        accumulatedLength: fullResponse.length,
        finalResponseLength: finalResponse.length,
        lengthDifference: lengthMismatch,
        tolerance,
        chunkCount,
        continuationChunkCount,
        note: 'Using finalResponse as source of truth',
      });
    } else if (lengthMismatch > 0) {
      logger.debug('Chunk accumulation length matches final response (within tolerance)', {
        discussionId,
        persona: persona.name,
        roundNumber,
        accumulatedLength: fullResponse.length,
        finalResponseLength: finalResponse.length,
        lengthDifference: lengthMismatch,
        chunkCount,
        continuationChunkCount,
      });
    } else {
      logger.debug('Chunk accumulation length matches final response perfectly', {
        discussionId,
        persona: persona.name,
        roundNumber,
        length: fullResponse.length,
        chunkCount,
        continuationChunkCount,
      });
    }

    // CRITICAL FIX 1.2: Use fullResponse (accumulated chunks) as source of truth
    // fullResponse contains all chunks that were actually emitted and received
    // finalResponse may be shorter if provider truncated, or longer if continuation wasn't emitted
    // We prioritize fullResponse because it represents what was actually streamed
    if (finalResponse && finalResponse.trim().length > 0) {
      if (finalResponse.length > fullResponse.length) {
        // Final response is longer - continuation was added but chunks may not have been emitted
        const additionalContent = finalResponse.slice(fullResponse.length);
        if (additionalContent.trim()) {
          logger.warn('⚠️ MISSING CONTINUATION CHUNKS DETECTED - Emitting additional content', {
            discussionId,
            persona: persona.name,
            roundNumber,
            initialLength: fullResponse.length,
            additionalLength: additionalContent.length,
            finalLength: finalResponse.length,
            additionalPreview: additionalContent.substring(0, 200),
            note: 'Continuation chunks were not properly emitted during streaming',
          });
          // Emit additional chunks so UI can display them
          const chunkSize = 100;
          for (let i = 0; i < additionalContent.length; i += chunkSize) {
            const chunk = additionalContent.slice(i, i + chunkSize);
            io.to(discussionId).emit('message-chunk', {
              discussionId: discussionId,
              chunk,
            });
          }
          // Update fullResponse to include the additional content
          fullResponse = finalResponse;
        } else {
          // No additional content, use finalResponse
          fullResponse = finalResponse;
        }
      } else if (finalResponse.length < fullResponse.length) {
        // CRITICAL FIX: Final response is shorter than accumulated chunks
        // This means the provider is returning trimmed/truncated content
        // We MUST use fullResponse (accumulated chunks) as source of truth
        logger.warn('⚠️ Final response shorter than accumulated chunks - using fullResponse as source of truth', {
          discussionId,
          persona: persona.name,
          roundNumber,
          accumulatedLength: fullResponse.length,
          finalLength: finalResponse.length,
          difference: fullResponse.length - finalResponse.length,
          chunkCount,
          continuationChunkCount,
          note: 'Using fullResponse (accumulated chunks) as source of truth - provider may have truncated',
        });
        // fullResponse already contains the correct content from chunks - keep it
        // DO NOT overwrite with shorter finalResponse
      } else {
        // Same length - prefer fullResponse (it's what was actually streamed)
        // But verify they match (within whitespace tolerance)
        if (fullResponse.trim() !== finalResponse.trim()) {
          logger.warn('⚠️ Response content mismatch despite same length - using fullResponse', {
            discussionId,
            persona: persona.name,
            roundNumber,
            note: 'Using fullResponse as it represents what was actually streamed',
          });
        }
        // Use fullResponse as it represents what was actually emitted
      }
    } else {
      // Final response is empty - use accumulated response
      logger.warn('⚠️ Final response from provider is empty - using accumulated response', {
        discussionId,
        persona: persona.name,
        roundNumber,
        accumulatedLength: fullResponse.length,
      });
      // Use accumulated response as fallback
      if (fullResponse.trim().length === 0) {
        throw new Error('Both accumulated and final responses are empty');
      }
    }

    // CRITICAL FIX 1.2: Final validation - ensure we have a valid response
    // fullResponse is now the source of truth (contains all accumulated chunks)
    if (fullResponse.trim().length === 0) {
      logger.error('🚨 CRITICAL: Final response is empty after processing', {
        discussionId,
        persona: persona.name,
        roundNumber,
        fullResponseLength: fullResponse.length,
        finalResponseLength: finalResponse.length,
        chunkCount,
        continuationChunkCount,
      });
      throw new Error('Response is empty after processing - no content was generated');
    }

    // Log final state for monitoring
    if (fullResponse.length !== finalResponse.length) {
      logger.info('📊 Response length difference (expected - using fullResponse as source of truth)', {
        discussionId,
        persona: persona.name,
        roundNumber,
        fullResponseLength: fullResponse.length,
        finalResponseLength: finalResponse.length,
        difference: Math.abs(fullResponse.length - finalResponse.length),
        chunkCount,
        continuationChunkCount,
        note: 'fullResponse (accumulated chunks) is source of truth',
      });
    }

      // ENHANCED: Final response validation - ensure response is complete before returning
      const { validateSentenceCompleteness } = await import('@/lib/llm/sentence-validation');
      const isComplete = validateSentenceCompleteness(
        fullResponse,
        'stop',
        persona.name,
        maxTokensForResponse
      );

      // PHASE 1: DIAGNOSTIC LOGGING - Completion and Truncation Metrics
      const hadCompletion = continuationChunkCount > 0 || (finalResponse.length > fullResponse.length);
      const truncationMetrics = {
        discussionId,
        persona: persona.name,
        provider: persona.provider,
        roundNumber,
        hadCompletion,
        completionAttempts: hadCompletion ? 1 : 0, // Will be updated by provider logs
        isComplete,
        responseLength: fullResponse.length,
        responseTokens: countTokens(fullResponse),
        estimatedTokens: estimateTokensFromChars(fullResponse.trim().length), // Use standardized token estimation
        maxTokens: maxTokensForResponse,
        tokenUtilization: maxTokensForResponse ? `${((estimateTokensFromChars(fullResponse.trim().length) / maxTokensForResponse) * 100).toFixed(1)}%` : 'N/A',
        chunkCount,
        continuationChunkCount,
        // Length analysis
        meetsMinimumLength: fullResponse.length >= 800, // Expected 2-4 paragraphs
        meetsTargetLength: fullResponse.length >= 1200, // Target 300-500 words
        endsWithPunctuation: /[.!?]\s*$/.test(fullResponse.trim()),
        lastChars: fullResponse.slice(-100),
        timestamp: new Date().toISOString(),
      };

      if (!isComplete) {
        logger.error('🚨 CRITICAL: Final response still appears incomplete after completion attempts', {
          ...truncationMetrics,
          lastChars: fullResponse.slice(-100),
          note: 'Response may be truncated despite completion attempts',
        });
        // Don't return incomplete response - this should have been caught by provider
        // But we'll return it with a warning since we can't retry here
      } else if (hadCompletion) {
        logger.info('✅ Response successfully completed after truncation detection', truncationMetrics);
      } else {
        logger.debug('Response completed without truncation', truncationMetrics);
      }
  } catch (streamError) {
    // Log the error with context
    logger.error('Error during LLM streaming', {
      discussionId,
      persona: persona.name,
      roundNumber,
      error: streamError instanceof Error ? streamError.message : String(streamError),
      errorStack: streamError instanceof Error ? streamError.stack : undefined,
    });

    // Emit error to client
    // Type guard for ErrorWithCode
    interface ErrorWithCode extends Error {
      code: ErrorCode;
    }
    const errorCode =
      streamError instanceof Error && 'code' in streamError
        ? (streamError as ErrorWithCode).code
        : ErrorCode.LLM_PROVIDER_ERROR;
    emitErrorToRoomWithDeduplication(
      io,
      discussionId,
      {
        code: errorCode,
        message:
          streamError instanceof Error
            ? streamError.message
            : 'An error occurred while generating the AI response. Please try again.',
      },
      'llm-streaming'
    );

    // Re-throw to be caught by outer error handler
    throw streamError;
  }

  // Validate response
  if (!fullResponse || fullResponse.trim().length === 0) {
    logger.error('Empty response from LLM provider', {
      discussionId,
      persona: persona.name,
      roundNumber,
    });
    const error = new Error('The AI provider returned an empty response. Please try again.');
    emitErrorToRoomWithDeduplication(
      io,
      discussionId,
      {
        code: ErrorCode.LLM_PROVIDER_ERROR,
        message: error.message,
      },
      'generate-ai-response'
    );
    throw error;
  }

  // Response length monitoring and quality checks
  const trimmedResponse = fullResponse.trim();
  const responseLength = trimmedResponse.length;
  const wordCount = trimmedResponse.split(/\s+/).filter(Boolean).length;

  // Estimate tokens using standardized estimation (estimateTokensFromChars already imported above)
  const estimatedTokens = estimateTokensFromChars(responseLength);
  // Use LLM_CONFIG default max tokens (can be overridden via MAX_TOKENS env var)
  const { LLM_CONFIG: LLM_CONFIG_FOR_VALIDATION } = await import('@/lib/config');
  const maxTokensForValidation = LLM_CONFIG_FOR_VALIDATION.DEFAULT_MAX_TOKENS;
  const tokenUtilization = (estimatedTokens / maxTokensForValidation) * 100;

  // Check for suspiciously short responses
  const isSuspiciouslyShort = responseLength < 200;
  const isVeryShort = responseLength < 100;

  // Check if response is less than 50% of expected length
  // Expected: ~250-500 words for 2-4 paragraphs, which is ~1000-2000 characters
  const expectedMinLength = 1000; // Conservative minimum for 2-4 paragraphs
  const isBelowExpected = responseLength < expectedMinLength * 0.5;

  // Log response metrics
  const logData: Record<string, any> = {
    discussionId,
    persona: persona.name,
    roundNumber,
    turn,
    exchangeNumber: turn,
    responseLength,
    wordCount,
    estimatedTokens,
    maxTokens: maxTokensForValidation,
    tokenUtilization: tokenUtilization.toFixed(1) + '%',
    responsePreview: trimmedResponse.substring(0, 100) + (responseLength > 100 ? '...' : ''),
    chunkCount,
    continuationChunkCount,
    endsWithPunctuation: /[.!?]\s*$/.test(trimmedResponse),
  };

  // Add warnings for short responses
  if (isVeryShort) {
    logger.warn('Very short response detected', {
      ...logData,
      warning: 'Response is less than 100 characters',
    });
  } else if (isSuspiciouslyShort) {
    logger.warn('Suspiciously short response detected', {
      ...logData,
      warning: 'Response is less than 200 characters',
    });
  }

  if (isBelowExpected) {
    logger.warn('Response below expected length', {
      ...logData,
      warning: 'Response is less than 50% of expected minimum length',
      expectedMinLength,
      actualLength: responseLength,
    });
  }

  if (tokenUtilization < 20) {
    logger.warn('Low token utilization', {
      ...logData,
      warning: 'Response used less than 20% of available tokens',
    });
  }

  logger.info('AI response generated successfully', logData);

  // CRITICAL DEBUG: Log response length at final stage
  logger.info('🔍 DEBUG: Response length at final stage', {
    discussionId,
    persona: persona.name,
    roundNumber,
    fullResponseLength: fullResponse.length,
    finalResponseLength: finalResponse.length,
    trimmedFullResponseLength: fullResponse.trim().length,
    chunkCount,
    continuationChunkCount,
    timestamp: new Date().toISOString(),
  });

  // CRITICAL FIX 1.2: Create message using finalResponse as source of truth
  // fullResponse has been set to finalResponse in the streaming logic above
  // Only trim whitespace, never truncate content
  const finalContent = fullResponse.trim(); // fullResponse is already set to finalResponse above

  // CRITICAL DEBUG: Log final content length
  logger.info('🔍 DEBUG: Final content before message creation', {
    discussionId,
    persona: persona.name,
    roundNumber,
    finalContentLength: finalContent.length,
    wordCount: finalContent.split(/\s+/).filter(Boolean).length,
    endsWithPunctuation: /[.!?]\s*$/.test(finalContent),
    timestamp: new Date().toISOString(),
  });

  logger.debug('Creating message with final response', {
    discussionId,
    persona: persona.name,
    roundNumber,
    contentLength: finalContent.length,
    originalFullResponseLength: fullResponse.length,
    originalFinalResponseLength: finalResponse.length,
  });

  // Create message with correct turn number
  // Turn number calculation: (roundNumber - 1) * 3 + position
  // Round 1: Analyzer = 1, Solver = 2, Moderator = 3
  // Round 2: Analyzer = 4, Solver = 5, Moderator = 6
  const message: import('@/types').ConversationMessage = {
    discussion_id: discussionId,
    persona: persona.name as 'Solver AI' | 'Analyzer AI' | 'Moderator AI',
    content: finalContent, // CRITICAL FIX 1.2: Use finalResponse (via fullResponse) - only trim whitespace
    turn, // This should be: Analyzer = (roundNumber-1)*3+1, Solver = (roundNumber-1)*3+2, Moderator = (roundNumber-1)*3+3
    timestamp: new Date().toISOString(),
    created_at: Date.now(),
  };

  // CRITICAL FIX 1.1: Verify turn number is correct (using expectedTurn calculated at function start)
  if (turn !== expectedTurn) {
    logger.error('Turn number mismatch detected!', {
      discussionId,
      persona: persona.name,
      roundNumber,
      actualTurn: turn,
      expectedTurn,
    });
    // Use the correct turn number
    message.turn = expectedTurn;
  }

  // Emit message complete
  io.to(discussionId).emit('message-complete', {
    discussionId: discussionId,
    message,
  });

  return message;
}

// Export named function for server.js
export function setupSocketIO(io: Server) {
  setupSocketHandlers(io);
}

// Also export as default for backward compatibility
export default setupSocketIO;
