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
  appendMessageToDiscussion,
  addRoundToDiscussion,
  addQuestionSetToDiscussion,
  updateRoundAnswers,
  readDiscussion,
} from '@/lib/discussions/file-manager';
import { loadDiscussionContext } from '@/lib/conversation-context';
import { formatLLMPrompt } from '@/lib/conversation-context';
import { getProviderWithFallback, aiPersonas, checkLLMProviderAvailability } from '@/lib/llm';
import type { LLMProvider } from '@/lib/llm/types';
import { summarizeRounds } from '@/lib/llm/summarizer';
import { generateQuestions } from '@/lib/llm/question-generator';
// Moderator summary generation removed - Moderator AI now participates in discussion
import { isResolved } from '@/lib/llm/resolver';
import {
  dialogueRequestSchema,
  userInputSchema,
  validateFile,
  BASE64_SIZE_LIMIT,
  validateBase64Format,
  sanitizeFileName,
} from '@/lib/validation';
import { verifyFileFromBase64 } from '@/lib/file-verification';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { authenticateSocket, getSocketUserId, isSocketAuthenticated } from '@/lib/socket/auth-middleware';
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
  UserInputEvent,
  DiscussionRound,
  SubmitAnswersEvent,
  ProceedDialogueEvent,
  GenerateSummaryEvent,
  GenerateQuestionsEvent,
} from '@/types';
import type { LLMMessage } from '@/lib/llm/types';
import type { FileData } from '@/lib/validation';

import { DIALOGUE_CONFIG } from '@/lib/config';

const MAX_TURNS = DIALOGUE_CONFIG.MAX_TURNS;

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
      socket.emit('error', {
        message: 'Too many connection attempts. Please wait a moment before trying again.',
        code: 'RATE_LIMIT_EXCEEDED',
      });
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
      socket.emit('error', {
        message: 'Maximum number of concurrent connections exceeded. Please close other connections and try again.',
        code: 'CONNECTION_LIMIT_EXCEEDED',
      });
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
        socket.emit('error', {
          message: 'Message payload is too large. Maximum size is 1MB.',
          code: 'PAYLOAD_TOO_LARGE',
        });
        return false;
      }

      // Check message rate limit
      if (checkMessageRateLimit(socket)) {
        logger.warn('Message rate limit exceeded', { socketId: socket.id });
        socket.emit('error', {
          message: 'Too many messages. Please slow down.',
          code: 'RATE_LIMIT_EXCEEDED',
        });
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
        // Validate files BEFORE rate limiting (don't count invalid requests toward rate limit)
        if (data.files && data.files.length > 0) {
          for (const file of data.files) {
            if (!file.name || !file.type || file.size === undefined) {
              const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'file' });
            socket.emit('error', {
              message: 'Invalid file data provided. Please try uploading the file again.',
              code: error.code,
            });
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
              socket.emit('error', {
                message: fileValidation.error || `File "${file.name}" validation failed.`,
                code: error.code,
              });
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
                socket.emit('error', {
                  message: `File "${file.name}" base64 encoding exceeds the ${BASE64_SIZE_LIMIT / (1024 * 1024)}MB limit. Please use a smaller file.`,
                  code: error.code,
                });
                return;
              }

              // Validate base64 format
              const base64FormatValidation = validateBase64Format(file.base64);
              if (!base64FormatValidation.isValid) {
                const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, {
                  field: 'file.base64',
                });
                socket.emit('error', {
                  message: `File "${file.name}" has invalid base64 encoding: ${base64FormatValidation.error}`,
                  code: error.code,
                });
                return;
              }

              // Verify file content matches declared MIME type using magic numbers
              try {
                const contentMatches = verifyFileFromBase64(file.base64, file.type);
                if (!contentMatches) {
                  const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, {
                    field: 'file.content',
                  });
                  socket.emit('error', {
                    message: `File "${file.name}" content does not match declared type "${file.type}". The file may be corrupted or the type may be incorrect.`,
                    code: error.code,
                  });
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
                socket.emit('error', {
                  message: `File "${file.name}" verification failed. Please ensure the file is valid and try again.`,
                  code: error.code,
                });
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
          socket.emit('error', {
            message: 'Invalid request format. Please check your input and try again.',
            code: error.code,
          });
          return;
        }

        if (!validationResult.success) {
          const errors = validationResult.error.errors
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join(', ');
          const validationError = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { errors });
          socket.emit('error', {
            message: `Invalid input: ${errors}. Please correct and try again.`,
            code: validationError.code,
          });
          return;
        }

        const { topic, files = [], userId } = validationResult.data;

        // Rate limiting check (after validation - only count valid requests)
        const clientIp = extractClientIP(socket);
        const rateLimitExceeded = await checkRateLimit(clientIp);
        if (rateLimitExceeded) {
          logger.warn('Rate limit exceeded', { socketId: socket.id, clientIp });
          const { getRemainingRequests } = await import('@/lib/rate-limit');
          const remaining = getRemainingRequests(clientIp);
          const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED, { clientIp });
          socket.emit('error', {
            message: error.message,
            code: error.code,
            rateLimit: {
              limit: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10', 10),
              remaining,
              resetWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
            },
          });
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
          socket.emit('error', {
            message: `No AI providers are configured. Please set at least one API key (GROQ_API_KEY, MISTRAL_API_KEY, or OPENROUTER_API_KEY). Errors: ${errorDetails}`,
            code: error.code,
          });
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
        const effectiveUserId = userId || getSocketUserId(socket);

        // Atomically check for active discussion to prevent race conditions
        // This prevents multiple requests from creating discussions simultaneously
        const { checkActiveDiscussionAtomically } = await import('@/lib/db/discussions');
        let hasActiveDiscussion = false;

        try {
          // Atomically check for active discussion in database
          // Uses BEGIN IMMEDIATE to get exclusive lock and prevent race conditions
          const activeDiscussion = checkActiveDiscussionAtomically(effectiveUserId);

          if (activeDiscussion) {
            // Active discussion exists
            hasActiveDiscussion = true;
            logger.warn('User attempted to start new discussion with active one', {
              userId: effectiveUserId,
              activeDiscussionId: activeDiscussion.id,
              socketId: socket.id,
            });
            const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, {
              reason: 'active_discussion_exists',
            });
            socket.emit('error', {
              message:
                'You already have an active discussion. Please resolve or delete your current discussion before starting a new one.',
              code: error.code,
            });
            return; // Prevent creating new discussion
          }

          // No active discussion, create files first (source of truth), then sync to database
          const fileResult = await syncFileAndDatabase(
            () => createDiscussionFiles(effectiveUserId, topic),
            (result) =>
              createDiscussion(effectiveUserId, topic, result.jsonPath, result.mdPath, result.id),
            { userId: effectiveUserId, operation: 'createDiscussion' }
          );
          const discussionId = fileResult.id;

          // Get the discussion from database to pass to processDiscussionDialogueRounds
          // This ensures the discussion exists before processing
          const discussion = getDiscussion(discussionId);
          if (!discussion) {
            logger.error('Discussion not found immediately after creation', {
              discussionId,
              userId: effectiveUserId,
              socketId: socket.id,
            });
            const error = createErrorFromCode(ErrorCode.INTERNAL_ERROR, { discussionId });
            socket.emit('error', {
              discussionId,
              message: 'Failed to create discussion. Please try again.',
              code: error.code,
            });
            return;
          }

          // Join discussion room
          socket.join(discussionId);

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
            userId: effectiveUserId,
            socketId: socket.id,
            isAnonymous: !userId,
          });

          // Start the dialogue loop (using round-based processing)
          logger.info('Starting dialogue processing (round-based)', {
            discussionId,
            userId: effectiveUserId,
            socketId: socket.id,
          });
          try {
            await processDiscussionDialogueRounds(
              io,
              socket,
              discussionId,
              effectiveUserId,
              topic,
              files || [],
              discussion
            );
          } catch (dialogueError) {
            logger.error('Error in processDiscussionDialogueRounds', {
              error: dialogueError instanceof Error ? dialogueError.message : String(dialogueError),
              errorStack: dialogueError instanceof Error ? dialogueError.stack : undefined,
              discussionId,
              userId: effectiveUserId,
              socketId: socket.id,
            });
            // Emit error with discussionId
            const error = createErrorFromCode(ErrorCode.INTERNAL_ERROR, { discussionId });
            io.to(discussionId).emit('error', {
              discussionId: discussionId,
              message:
                dialogueError instanceof Error
                  ? dialogueError.message
                  : 'Failed to process dialogue. Please try again.',
              code: error.code,
            });
            throw dialogueError;
          }
        } catch (error) {
          logger.error('Error creating discussion', {
            error,
            userId: effectiveUserId,
            socketId: socket.id,
          });
          const errorObj = createErrorFromCode(ErrorCode.INTERNAL_ERROR, {
            userId: effectiveUserId,
          });
          socket.emit('error', {
            message:
              error instanceof Error
                ? error.message
                : 'Failed to create discussion. Please try again.',
            code: errorObj.code,
          });
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
        socket.emit('error', {
          discussionId,
          message:
            error instanceof Error ? error.message : 'Failed to start dialogue. Please try again.',
          code: errorObj.code,
        });
      }
    });

    // Handle user input
    socket.on('user-input', async (data: UserInputEvent, ack?: (response: { error?: string; data?: unknown }) => void) => {
      if (!checkMessageLimits(data)) {
        if (ack) ack({ error: 'Message limits exceeded' });
        return;
      }
      logger.info('Received user-input event', {
        socketId: socket.id,
        discussionId: data?.discussionId,
        inputLength: data?.input?.length,
      });

      try {
        // Rate limiting check
        const clientIp = extractClientIP(socket);
        if (await checkRateLimit(clientIp)) {
          logger.warn('Rate limit exceeded for user input', { socketId: socket.id, clientIp });
          const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED, { clientIp });
          socket.emit('error', {
            message: 'Rate limit exceeded. Please wait a moment before trying again.',
            code: error.code,
          });
          return;
        }

        // Validate request data including conversation ID format
        const validationResult = userInputSchema.safeParse(data);
        if (!validationResult.success) {
          const errors = validationResult.error.errors
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join(', ');
          logger.warn('User input validation failed', { socketId: socket.id, errors });
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { errors });
          socket.emit('error', {
            message: `Invalid input format: ${errors}. Please try again.`,
            code: error.code,
          });
          return;
        }

        const { discussionId, input } = validationResult.data;

        if (!input || !input.trim()) {
          logger.warn('Empty user input received', { socketId: socket.id, discussionId });
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'input' });
          socket.emit('error', {
            message: 'Please provide your input to continue the conversation.',
            code: error.code,
          });
          return;
        }

        // Always use discussion-based system
        const effectiveDiscussionId = discussionId;

        if (!effectiveDiscussionId) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'discussionId' });
          socket.emit('error', {
            message: 'No discussion ID provided.',
            code: error.code,
          });
          return;
        }

        const discussion = getDiscussion(effectiveDiscussionId);
        if (!discussion) {
          logger.error('Discussion not found for user input', {
            socketId: socket.id,
            discussionId: effectiveDiscussionId,
          });
          const notFoundError = createErrorFromCode(ErrorCode.DISCUSSION_NOT_FOUND, {
            discussionId: effectiveDiscussionId,
          });
          socket.emit('error', {
            discussionId: effectiveDiscussionId,
            message: 'Discussion not found. Please start a new dialogue.',
            code: notFoundError.code,
          });
          return;
        }

        // Validate discussion state before processing input
        // Check if discussion is resolved
        if (discussion.is_resolved) {
          logger.warn('User input received for resolved discussion', {
            socketId: socket.id,
            discussionId: effectiveDiscussionId,
          });
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, {
            reason: 'discussion_resolved',
          });
          socket.emit('error', {
            discussionId: effectiveDiscussionId,
            message: 'This discussion has already been resolved. Please start a new dialogue.',
            code: error.code,
          });
          return;
        }

        // Check if discussion is currently being processed
        const { isProcessing } = await import('@/lib/discussions/processing-lock');
        // Get user ID from authenticated socket
        const userId = getSocketUserId(socket);
        if (await isProcessing(effectiveDiscussionId, userId)) {
          logger.warn('User input received while discussion is processing', {
            socketId: socket.id,
            discussionId: effectiveDiscussionId,
          });
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, {
            reason: 'discussion_processing',
          });
          socket.emit('error', {
            discussionId: effectiveDiscussionId,
            message:
              'Discussion is currently being processed. Please wait for the current operation to complete.',
            code: error.code,
          });
          return;
        }

        // Verify discussion is waiting for user input (optional check - we allow proactive input)
        if (!discussion.needs_user_input) {
          logger.debug('User input received but discussion not explicitly waiting for input (allowing proactive input)', {
            socketId: socket.id,
            discussionId: effectiveDiscussionId,
            needs_user_input: discussion.needs_user_input,
          });
        }

        // Load discussion context to get messages
        let discussionContext;
        try {
          discussionContext = await loadDiscussionContext(
            effectiveDiscussionId,
            discussion.user_id
          );

          // Sync token count from file (source of truth) to database
          // This ensures database token_count stays in sync with file content
          try {
            syncTokenCountFromFile(effectiveDiscussionId, discussionContext.tokenCount);
          } catch (syncError) {
            // Log but don't fail - token count sync is best effort
            logger.warn('Failed to sync token count to database', {
              error: syncError,
              discussionId: effectiveDiscussionId,
              tokenCount: discussionContext.tokenCount,
            });
          }
        } catch (error) {
          logger.error('Error loading discussion context for user input', {
            error,
            discussionId: effectiveDiscussionId,
          });
          const errorObj = createErrorFromCode(ErrorCode.INTERNAL_ERROR, {
            discussionId: effectiveDiscussionId,
          });
          socket.emit('error', {
            discussionId: effectiveDiscussionId,
            message: 'Failed to load discussion context. Please try again.',
            code: errorObj.code,
          });
          return;
        }

        const allMessages = discussionContext.messages;
        const aiMessages = allMessages.filter((m) => m.persona !== 'User');
        const lastAIMessage = aiMessages[aiMessages.length - 1];

        // Calculate user turn
        let userTurn: number;
        if (lastAIMessage) {
          userTurn = lastAIMessage.turn;
        } else if (discussion.current_turn > 0) {
          userTurn = Math.floor(discussion.current_turn / 2) + 1;
        } else {
          userTurn = 1;
        }

        // Create user message
        const userMessage = {
          discussion_id: effectiveDiscussionId,
          persona: 'User' as const,
          content: input.trim(),
          turn: userTurn,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        };

        // Append to discussion files first (source of truth), then sync to database
        try {
          await syncFileAndDatabase(
            () => appendMessageToDiscussion(effectiveDiscussionId, discussion.user_id, userMessage),
            () =>
              updateDiscussion(effectiveDiscussionId, {
                needs_user_input: 0,
                user_input_pending: null,
              }),
            {
              discussionId: effectiveDiscussionId,
              userId: discussion.user_id,
              operation: 'appendUserMessage',
            }
          );
        } catch (error) {
          logger.error('Error appending user message to discussion', {
            error,
            discussionId: effectiveDiscussionId,
          });
          const errorObj = createErrorFromCode(ErrorCode.INTERNAL_ERROR, {
            discussionId: effectiveDiscussionId,
          });
          socket.emit('error', {
            discussionId: effectiveDiscussionId,
            message: 'Failed to save user input. Please try again.',
            code: errorObj.code,
          });
          return;
        }

        logger.info('User input processed for discussion', {
          discussionId: effectiveDiscussionId,
          userId: discussion.user_id,
        });

        // Send acknowledgment
        if (ack) {
          ack({ data: { discussionId: effectiveDiscussionId } });
        }

        // Continue dialogue (using round-based processing)
        await processDiscussionDialogueRounds(
          io,
          socket,
          effectiveDiscussionId,
          discussion.user_id,
          discussion.topic,
          [],
          discussion
        );
      } catch (error) {
        logger.error('Error handling user input', { error, socketId: socket.id });
        const errorDiscussionId = data?.discussionId;
        const errorObj = createErrorFromCode(ErrorCode.INTERNAL_ERROR, {
          discussionId: errorDiscussionId,
        });
        socket.emit('error', {
          discussionId: errorDiscussionId,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to process user input. Please try again.',
          code: errorObj.code,
        });
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
          const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED, { clientIp });
          socket.emit('error', {
            message: 'Rate limit exceeded. Please wait a moment before trying again.',
            code: error.code,
          });
          return;
        }

        const { discussionId, roundNumber, answers } = data;

        if (!discussionId) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'discussionId' });
          socket.emit('error', {
            message: 'No discussion ID provided.',
            code: error.code,
          });
          return;
        }

        if (!roundNumber || roundNumber < 1) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'roundNumber' });
          socket.emit('error', {
            message: 'Invalid round number.',
            code: error.code,
          });
          return;
        }

        if (!answers || Object.keys(answers).length === 0) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'answers' });
          socket.emit('error', {
            message: 'No answers provided.',
            code: error.code,
          });
          return;
        }

        const discussion = getDiscussion(discussionId);
        if (!discussion) {
          logger.error('Discussion not found for answer submission', {
            socketId: socket.id,
            discussionId,
          });
          const notFoundError = createErrorFromCode(ErrorCode.DISCUSSION_NOT_FOUND, {
            discussionId,
          });
          socket.emit('error', {
            discussionId: discussionId,
            message: 'Discussion not found. Please start a new dialogue.',
            code: notFoundError.code,
          });
          return;
        }

        // Verify user owns the discussion
        const userId = getSocketUserId(socket);
        if (!verifyDiscussionOwnership(discussionId, userId)) {
          const authError = createAuthorizationError(discussionId);
          socket.emit('error', authError);
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
        socket.emit('error', {
          discussionId: discussionId,
          message:
            error instanceof Error ? error.message : 'Failed to process answers. Please try again.',
          code: errorObj.code,
        });
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
          const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED, { clientIp });
          socket.emit('error', {
            message: 'Rate limit exceeded. Please wait a moment before trying again.',
            code: error.code,
          });
          return;
        }

        const { discussionId } = data;

        if (!discussionId) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'discussionId' });
          socket.emit('error', {
            message: 'No discussion ID provided.',
            code: error.code,
          });
          return;
        }

        const discussion = getDiscussion(discussionId);
        if (!discussion) {
          logger.error('Discussion not found for proceed-dialogue', {
            socketId: socket.id,
            discussionId,
          });
          const notFoundError = createErrorFromCode(ErrorCode.DISCUSSION_NOT_FOUND, {
            discussionId,
          });
          socket.emit('error', {
            discussionId: discussionId,
            message: 'Discussion not found. Please start a new dialogue.',
            code: notFoundError.code,
          });
          return;
        }

        // Verify user owns the discussion
        const userId = getSocketUserId(socket);
        if (!verifyDiscussionOwnership(discussionId, userId)) {
          const authError = createAuthorizationError(discussionId);
          socket.emit('error', authError);
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
        socket.emit('error', {
          discussionId: discussionId,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to proceed with dialogue. Please try again.',
          code: errorObj.code,
        });
      }
    });

    // Handle generate-summary event
    socket.on('generate-summary', async (data: GenerateSummaryEvent, ack?: (response: { error?: string; data?: unknown }) => void) => {
      if (!checkMessageLimits(data)) {
        if (ack) ack({ error: 'Message limits exceeded' });
        return;
      }
      logger.info('Received generate-summary event', {
        socketId: socket.id,
        discussionId: data?.discussionId,
        roundNumber: data?.roundNumber,
      });

      try {
        // Rate limiting check
        const clientIp = extractClientIP(socket);
        if (await checkRateLimit(clientIp)) {
          logger.warn('Rate limit exceeded for generate-summary', {
            socketId: socket.id,
            clientIp,
          });
          const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED, { clientIp });
          socket.emit('error', {
            message: 'Rate limit exceeded. Please wait a moment before trying again.',
            code: error.code,
          });
          return;
        }

        const { discussionId, roundNumber } = data;

        if (!discussionId) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'discussionId' });
          socket.emit('error', {
            message: 'No discussion ID provided.',
            code: error.code,
          });
          return;
        }

        const discussion = getDiscussion(discussionId);
        if (!discussion) {
          logger.error('Discussion not found for generate-summary', {
            socketId: socket.id,
            discussionId,
          });
          const notFoundError = createErrorFromCode(ErrorCode.DISCUSSION_NOT_FOUND, {
            discussionId,
          });
          socket.emit('error', {
            discussionId: discussionId,
            message: 'Discussion not found. Please start a new dialogue.',
            code: notFoundError.code,
          });
          return;
        }

        // Verify user owns the discussion
        const userId = getSocketUserId(socket);
        if (!verifyDiscussionOwnership(discussionId, userId)) {
          const authError = createAuthorizationError(discussionId);
          socket.emit('error', authError);
          return;
        }

        // Load discussion data
        const discussionData = await readDiscussion(discussionId, discussion.user_id);

        // Determine which rounds to summarize
        const targetRoundNumber = roundNumber || discussionData.currentRound || 0;
        const roundsToSummarize = (discussionData.rounds || []).filter(
          (r) => r.roundNumber <= targetRoundNumber
        );

        if (roundsToSummarize.length === 0) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, {
            reason: 'no_rounds_to_summarize',
          });
          socket.emit('error', {
            discussionId: discussionId,
            message: 'No rounds available to summarize.',
            code: error.code,
          });
          return;
        }

        // Generate summary
        const summaryEntry = await summarizeRounds(
          discussionId,
          discussion.user_id,
          roundsToSummarize,
          targetRoundNumber
        );

        // Emit summary created
        io.to(discussionId).emit('summary-created', {
          discussionId: discussionId,
          summary: summaryEntry,
        });

        // Send acknowledgment
        if (ack) {
          ack({ data: { discussionId, summary: summaryEntry } });
        }

        logger.info('Summary generated successfully', {
          discussionId,
          roundNumber: targetRoundNumber,
          roundsSummarized: roundsToSummarize.length,
        });
      } catch (error) {
        logger.error('Error handling generate-summary', { error, socketId: socket.id });
        const discussionId = data?.discussionId;
        const errorObj = createErrorFromCode(ErrorCode.INTERNAL_ERROR, { discussionId });
        socket.emit('error', {
          discussionId: discussionId,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to generate summary. Please try again.',
          code: errorObj.code,
        });
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
          const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED, { clientIp });
          socket.emit('error', {
            message: 'Rate limit exceeded. Please wait a moment before trying again.',
            code: error.code,
          });
          return;
        }

        const { discussionId, roundNumber } = data;

        if (!discussionId) {
          const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'discussionId' });
          socket.emit('error', {
            message: 'No discussion ID provided.',
            code: error.code,
          });
          return;
        }

        const discussion = getDiscussion(discussionId);
        if (!discussion) {
          logger.error('Discussion not found for generate-questions', {
            socketId: socket.id,
            discussionId,
          });
          const notFoundError = createErrorFromCode(ErrorCode.DISCUSSION_NOT_FOUND, {
            discussionId,
          });
          socket.emit('error', {
            discussionId: discussionId,
            message: 'Discussion not found. Please start a new dialogue.',
            code: notFoundError.code,
          });
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
          socket.emit('error', {
            discussionId: discussionId,
            message: `Round ${targetRoundNumber} not found.`,
            code: error.code,
          });
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
        socket.emit('error', {
          discussionId: discussionId,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to generate questions. Please try again.',
          code: errorObj.code,
        });
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
  const discussionRecord = discussion || getDiscussion(discussionId);
  if (!discussionRecord) {
    logger.error('Discussion not found in processDiscussionDialogueRounds', { discussionId });
    io.to(discussionId).emit('error', {
      discussionId: discussionId,
      message: 'Discussion not found. Please start a new dialogue.',
      code: ErrorCode.DISCUSSION_NOT_FOUND,
    });
    return;
  }

  // Check if already resolved
  if (discussionRecord.is_resolved) {
    logger.info('Discussion already resolved, emitting resolved event', { discussionId });
    io.to(discussionId).emit('conversation-resolved', { discussionId: discussionId });
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
      io.to(discussionId).emit('error', {
        discussionId,
        message: 'Discussion is already being processed. Please wait for the current operation to complete.',
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }
    throw error;
  }
}

async function processDiscussionDialogueRoundsInternal(
  io: Server,
  _socket: Socket,
  discussionId: string,
  userId: string,
  topic: string,
  files: FileData[]
) {
  let discussionData;
  const partialStateCreated = false;

  try {
    // Load discussion data to get current round
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
      io.to(discussionId).emit('error', {
        discussionId: discussionId,
        message: 'Failed to load discussion data. Please try again.',
      });
      return;
    }

    const currentRoundNumber = (discussionData.currentRound || 0) + 1;
    const maxRounds = Math.floor(MAX_TURNS / 3); // Each round has 3 AI responses (Solver, Analyzer, Moderator)

    logger.info('Processing round', {
      discussionId,
      currentRoundNumber,
      maxRounds,
      previousRound: discussionData.currentRound,
    });

    if (currentRoundNumber > maxRounds) {
      logger.info('Discussion reached max rounds', { discussionId, currentRoundNumber, maxRounds });
      io.to(discussionId).emit('conversation-resolved', { discussionId: discussionId });
      return;
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
      io.to(discussionId).emit('error', {
        discussionId: discussionId,
        message: 'Failed to load discussion context. Please try again.',
      });
      return;
    }

    const isFirstRound = currentRoundNumber === 1;
    const solverPersona = aiPersonas.solver;
    const analyzerPersona = aiPersonas.analyzer;
    const moderatorPersona = aiPersonas.moderator;

    // Collect user answers from previous rounds for context
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

    try {
    logger.info('Starting round processing', {
      discussionId,
      roundNumber: currentRoundNumber,
      isFirstRound,
      hasFiles: files.length > 0,
    });

    // Process Solver AI response first with error recovery
    logger.debug('Generating Solver AI response', { discussionId, roundNumber: currentRoundNumber });
    let solverResponse: import('@/types').ConversationMessage;
    try {
      solverResponse = await generateAIResponse(
        io,
        discussionId,
        solverPersona,
        topic,
        discussionContext,
        isFirstRound,
        files,
        currentRoundNumber,
        userAnswers
      );
    } catch (error) {
      logger.error('Solver AI response failed, round cannot continue', {
        discussionId,
        roundNumber: currentRoundNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      // Re-throw to be caught by outer error handler
      throw error;
    }
    logger.debug('Solver AI response generated', {
      discussionId,
      roundNumber: currentRoundNumber,
      responseLength: solverResponse.content.length,
    });

    // For Analyzer's context, we need to include Solver's response
    // Create a temporary round with just Solver's response for context
    const tempRoundForAnalyzerContext: DiscussionRound = {
      roundNumber: currentRoundNumber,
      solverResponse,
      analyzerResponse: {
        discussion_id: discussionId,
        persona: 'Analyzer AI',
        content: '', // Empty, will be filled
        turn: currentRoundNumber * 3 - 1, // Placeholder turn number
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
      moderatorResponse: {
        discussion_id: discussionId,
        persona: 'Moderator AI',
        content: '', // Empty placeholder
        turn: currentRoundNumber * 3, // Placeholder turn number
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
      timestamp: new Date().toISOString(),
    };

    // Update context to include Solver's response
    const contextWithSolver = {
      ...discussionContext,
      rounds: [...(discussionContext.rounds || []), tempRoundForAnalyzerContext],
    };

    // Process Analyzer AI response (with context that includes Solver's response)
    logger.debug('Generating Analyzer AI response', { discussionId, roundNumber: currentRoundNumber });
    let analyzerResponse: import('@/types').ConversationMessage;
    try {
      analyzerResponse = await generateAIResponse(
        io,
        discussionId,
        analyzerPersona,
        topic,
        contextWithSolver,
        false, // Not first message
        undefined, // No files after first round
        currentRoundNumber,
        userAnswers
      );
    } catch (error) {
      logger.error('Analyzer AI response failed, round cannot continue', {
        discussionId,
        roundNumber: currentRoundNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      // Re-throw to be caught by outer error handler
      throw error;
    }
    logger.debug('Analyzer AI response generated', {
      discussionId,
      roundNumber: currentRoundNumber,
      responseLength: analyzerResponse.content.length,
    });

    // For Moderator's context, we need to include Solver's and Analyzer's responses
    // Create a temporary round with Solver and Analyzer responses for context
    const tempRoundForModeratorContext: DiscussionRound = {
      roundNumber: currentRoundNumber,
      solverResponse,
      analyzerResponse,
      moderatorResponse: {
        discussion_id: discussionId,
        persona: 'Moderator AI',
        content: '', // Empty, will be filled
        turn: currentRoundNumber * 3, // Placeholder turn number
        timestamp: new Date().toISOString(),
        created_at: Date.now(),
      },
      timestamp: new Date().toISOString(),
    };

    // Update context to include both Solver's and Analyzer's responses
    const contextWithBoth = {
      ...discussionContext,
      rounds: [...(discussionContext.rounds || []), tempRoundForModeratorContext],
    };

    // Process Moderator AI response (with context that includes Solver's and Analyzer's responses)
    logger.debug('Generating Moderator AI response', { discussionId, roundNumber: currentRoundNumber });
    let moderatorResponse: import('@/types').ConversationMessage;
    try {
      moderatorResponse = await generateAIResponse(
        io,
        discussionId,
        moderatorPersona,
        topic,
        contextWithBoth,
        false, // Not first message
        undefined, // No files after first round
        currentRoundNumber,
        userAnswers
      );
    } catch (error) {
      logger.error('Moderator AI response failed, round cannot continue', {
        discussionId,
        roundNumber: currentRoundNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      // Re-throw to be caught by outer error handler
      throw error;
    }
    logger.debug('Moderator AI response generated', {
      discussionId,
      roundNumber: currentRoundNumber,
      responseLength: moderatorResponse.content.length,
    });

    // Create round object with all three responses
    const round: DiscussionRound = {
      roundNumber: currentRoundNumber,
      solverResponse,
      analyzerResponse,
      moderatorResponse,
      timestamp: new Date().toISOString(),
    };

    // Store round in files first (source of truth), then sync to database
    logger.debug('Saving round to storage', { discussionId, roundNumber: currentRoundNumber });
    await syncFileAndDatabase(
      () => addRoundToDiscussion(discussionId, userId, round),
        () =>
        updateDiscussion(discussionId, {
          current_turn: currentRoundNumber * 3, // Each round = 3 turns (Solver, Analyzer, Moderator)
        }),
      { discussionId, userId, operation: 'addRound' }
    );
    logger.debug('Round saved to storage', { discussionId, roundNumber: currentRoundNumber });

    // Emit round complete
    logger.info('Emitting round-complete event', { discussionId, roundNumber: currentRoundNumber });
    io.to(discussionId).emit('round-complete', {
      discussionId: discussionId,
      round,
    });

    logger.info('Round completed successfully', {
      discussionId,
      roundNumber: currentRoundNumber,
      solverLength: solverResponse.content.length,
      analyzerLength: analyzerResponse.content.length,
      moderatorLength: moderatorResponse.content.length,
    });

    // Moderator AI now participates in discussion, no separate summary generation needed

    // Check if automatic summary is needed
    // Triggers: every 5 rounds OR 5+ rounds since last summary OR token count approaching limit
    const lastSummaryRound = discussionContext.currentSummary?.roundNumber || 0;
    const roundsSinceLastSummary = currentRoundNumber - lastSummaryRound;
    const { getTokenLimit } = await import('@/lib/discussions/token-counter');
    const tokenLimit = getTokenLimit();
    const tokenThreshold = Math.floor(tokenLimit * 0.8); // Trigger at 80% of limit

    // Check token count (most important)
    const needsAutoSummaryByToken = discussionContext.tokenCount >= tokenThreshold;

    // Check round count
    const needsAutoSummaryByRounds =
      currentRoundNumber % 5 === 0 || roundsSinceLastSummary >= 5;

    const needsAutoSummary = needsAutoSummaryByToken || needsAutoSummaryByRounds;

    // Auto-generate summary if needed (every 5 rounds or if 5+ rounds since last summary)
    if (needsAutoSummary) {
      try {
        const roundsToSummarize = discussionData.rounds || [];
        const summaryEntry = await summarizeRounds(
          discussionId,
          userId,
          [...roundsToSummarize, round],
          currentRoundNumber
        );

        // Emit summary created
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
        // Reset trigger on summarization failure to allow retry
        logger.error('Auto-summary generation failed, will retry on next trigger', {
          discussionId,
          roundNumber: currentRoundNumber,
          error: summaryError instanceof Error ? summaryError.message : String(summaryError),
        });
        // Don't fail the round if summarization fails
      }
    }

    // Check for resolution
    const allRounds = [...(discussionData.rounds || []), round];
    const allMessages = allRounds.flatMap((r) => [r.solverResponse, r.analyzerResponse, r.moderatorResponse]);
    if (allMessages.length >= 6) {
      const resolved = isResolved(allMessages);
      if (resolved) {
        logger.info('Discussion resolved', { discussionId, roundNumber: currentRoundNumber });
        updateDiscussion(discussionId, { is_resolved: 1 });
        io.to(discussionId).emit('conversation-resolved', { discussionId: discussionId });
        return;
      }
    }
  } catch (error) {
    // Error recovery: clean up partial state
    logger.error('Error processing round, cleaning up partial state', {
      discussionId,
      userId,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      partialStateCreated,
    });

    // Mark discussion as failed if we created partial state
    if (partialStateCreated) {
      try {
        updateDiscussion(discussionId, {
          // Note: We don't have a 'failed' status field, but we can log it
          // In a future enhancement, we could add a status field
        });
        logger.warn('Discussion may have partial state after error', { discussionId, userId });
      } catch (cleanupError) {
        logger.error('Failed to mark discussion as failed during cleanup', {
          discussionId,
          userId,
          cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }

    // Emit error to client
    io.to(discussionId).emit('error', {
      discussionId,
      message:
        error instanceof Error
          ? error.message
          : 'An error occurred while processing the discussion. Please try again.',
      code: ErrorCode.INTERNAL_ERROR,
    });

    // Re-throw to be caught by outer handler
    throw error;
    }
  } catch (outerError) {
    // Catch any errors from outer try block (loading data, context, etc.)
    logger.error('Error in processDiscussionDialogueRoundsInternal (outer catch)', {
      discussionId,
      userId,
      error: outerError instanceof Error ? outerError.message : String(outerError),
      errorStack: outerError instanceof Error ? outerError.stack : undefined,
    });

    io.to(discussionId).emit('error', {
      discussionId,
      message: 'An error occurred while processing the discussion. Please try again.',
      code: ErrorCode.INTERNAL_ERROR,
    });

    throw outerError;
  }
}

/**
 * Helper function to generate AI response for a round
 */
async function generateAIResponse(
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
  // Build messages for LLM
  const llmMessages: LLMMessage[] = [{ role: 'system', content: persona.systemPrompt }];

  // Format conversation context
  // Use rounds if available (new structure), fallback to messages (legacy)
  const allMessages = discussionContext.messages || [];
  const rounds = discussionContext.rounds || [];
  const isFirstMessageForPrompt = isFirstMessage && rounds.length === 0 && allMessages.length === 0;

  const userPrompt = formatLLMPrompt(
    topic,
    allMessages,
    isFirstMessageForPrompt,
    persona.name as 'Solver AI' | 'Analyzer AI' | 'Moderator AI',
    isFirstMessageForPrompt ? files : undefined,
    discussionContext.summary, // Legacy
    rounds, // New
    discussionContext.currentSummary, // New
    discussionContext.summaries, // New: all summaries
    userAnswers // New
  );

  logger.debug('Generated prompt for AI response', {
    discussionId,
    persona: persona.name,
    roundNumber,
    isFirstMessage: isFirstMessageForPrompt,
    promptLength: userPrompt.length,
    roundsCount: rounds.length,
    messagesCount: allMessages.length,
  });

  llmMessages.push({
    role: 'user',
    content: userPrompt,
    files: isFirstMessage ? files : undefined,
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
    io.to(discussionId).emit('error', {
      discussionId: discussionId,
      message:
        providerError instanceof Error
          ? providerError.message
          : 'No LLM providers are available. Please check your API key configuration.',
      code: ErrorCode.LLM_PROVIDER_ERROR,
    });

    // Re-throw to be caught by outer error handler
    throw providerError;
  }

  // Emit message start
  // Calculate turn from round: Round N has turns (N-1)*3+1, (N-1)*3+2, (N-1)*3+3
  // For round 1: turns 1, 2, 3
  // For round 2: turns 4, 5, 6
  // Order: Solver -> Analyzer -> Moderator
  let turn: number;
  if (persona.name === 'Solver AI') {
    turn = (roundNumber - 1) * 3 + 1;
  } else if (persona.name === 'Analyzer AI') {
    turn = (roundNumber - 1) * 3 + 2;
  } else if (persona.name === 'Moderator AI') {
    turn = (roundNumber - 1) * 3 + 3;
  } else {
    turn = roundNumber; // Fallback
  }
  logger.info('Starting message generation', {
    discussionId,
    persona: persona.name,
    round: roundNumber,
    turn,
  });
  io.to(discussionId).emit('message-start', {
    discussionId: discussionId,
    persona: persona.name,
    turn,
  });

  // Stream response with error handling
  let fullResponse = '';
  try {
    await provider.stream(llmMessages, (chunk: string) => {
      if (typeof chunk !== 'string') {
        logger.warn('Received non-string chunk from LLM provider', {
          persona: persona.name,
          discussionId,
        });
        return;
      }
      fullResponse += chunk;
      // Emit chunk in real-time
      io.to(discussionId).emit('message-chunk', {
        discussionId: discussionId,
        chunk,
      });
    });
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
    const errorCode =
      streamError instanceof Error && 'code' in streamError
        ? (streamError as any).code
        : ErrorCode.LLM_PROVIDER_ERROR;
    io.to(discussionId).emit('error', {
      discussionId: discussionId,
      message:
        streamError instanceof Error
          ? streamError.message
          : 'An error occurred while generating the AI response. Please try again.',
      code: errorCode,
    });

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
    io.to(discussionId).emit('error', {
      discussionId: discussionId,
      message: error.message,
      code: ErrorCode.LLM_PROVIDER_ERROR,
    });
    throw error;
  }

  logger.debug('AI response generated successfully', {
    discussionId,
    persona: persona.name,
    roundNumber,
    responseLength: fullResponse.trim().length,
  });

  // Create message
  const message: import('@/types').ConversationMessage = {
    discussion_id: discussionId,
    persona: persona.name as 'Solver AI' | 'Analyzer AI' | 'Moderator AI',
    content: fullResponse.trim(),
    turn,
    timestamp: new Date().toISOString(),
    created_at: Date.now(),
  };

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
