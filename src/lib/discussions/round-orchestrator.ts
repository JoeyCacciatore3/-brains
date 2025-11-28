/**
 * Round Execution Orchestrator
 * Orchestrates the entire round processing with clear step-by-step execution
 * Provides centralized error recovery and event emission
 */

import type { Server } from 'socket.io';
import type { DiscussionRound, ConversationMessage } from '@/types';
import type { FileData } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { loadDiscussionContext } from '@/lib/discussion-context';
import { generateAIResponse } from '@/lib/socket/handlers';
import {
  createInitialStateContext,
  updateStateContextWithResponse,
  validateFinalRound,
  validateRoundState,
  getNextPersona,
  type RoundStateContext,
} from './round-processor';
import { calculateTurnNumber } from './round-utils';

export interface RoundConfig {
  io: Server;
  discussionId: string;
  userId: string; // CRITICAL: Required for loadDiscussionContext ownership verification
  topic: string;
  isFirstRound: boolean;
  files: FileData[];
  currentRoundNumber: number;
  userAnswers: Record<string, string[]>;
  existingRounds: DiscussionRound[];
}

export interface RoundResult {
  round: DiscussionRound;
  context: RoundStateContext;
  success: boolean;
  error?: Error;
}

/**
 * Execute a round with step-by-step orchestration
 * This provides a clear, logical chain of events with validation at each step
 */
export async function executeRound(config: RoundConfig): Promise<RoundResult> {
  const { io, discussionId, userId, topic, isFirstRound, files, currentRoundNumber, userAnswers, existingRounds } = config;

  logger.info('🎯 ROUND ORCHESTRATOR: Starting round execution', {
    discussionId,
    roundNumber: currentRoundNumber,
    isFirstRound,
    timestamp: new Date().toISOString(),
  });

  // Step 1: Validate round state
  logger.info('🎯 STEP 1: Validating round state', {
    discussionId,
    roundNumber: currentRoundNumber,
  });
  const stateValidation = validateRoundState(currentRoundNumber, existingRounds);
  if (!stateValidation.isValid) {
    const error = new Error(`Round state validation failed: ${stateValidation.message}`);
    logger.error('Round state validation failed', {
      discussionId,
      roundNumber: currentRoundNumber,
      errors: stateValidation.errors,
    });
    return {
      round: {} as DiscussionRound,
      context: { state: 'ERROR', roundNumber: currentRoundNumber, error },
      success: false,
      error,
    };
  }

  // Step 2: Load context
  logger.info('🎯 STEP 2: Loading discussion context', {
    discussionId,
    userId,
    roundNumber: currentRoundNumber,
  });
  let discussionContext;
  try {
    // CRITICAL FIX: Pass userId parameter for ownership verification
    discussionContext = await loadDiscussionContext(discussionId, userId);
  } catch (error) {
    const contextError = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to load discussion context', {
      discussionId,
      userId,
      roundNumber: currentRoundNumber,
      error: contextError.message,
    });
    return {
      round: {} as DiscussionRound,
      context: { state: 'ERROR', roundNumber: currentRoundNumber, error: contextError },
      success: false,
      error: contextError,
    };
  }

  // Step 3: Create initial state context
  let context = createInitialStateContext(currentRoundNumber);
  context = { ...context, state: 'VALIDATING' };
  context = { ...context, state: 'PROCESSING_ANALYZER' };

  // Step 4: Process Analyzer (with validation)
  logger.info('🎯 STEP 4: Processing Analyzer AI', {
    discussionId,
    roundNumber: currentRoundNumber,
  });
  try {
    const analyzerPersona = getNextPersona('PROCESSING_ANALYZER');
    if (!analyzerPersona || analyzerPersona.name !== 'Analyzer AI') {
      throw new Error(`Invalid Analyzer persona: ${analyzerPersona?.name || 'null'}`);
    }

    // ALL LLMs see ALL rounds - no filtering needed
    // Execution order is enforced separately and does not affect context visibility
    const contextForAnalyzer = discussionContext;

    logger.info('🔍 Context prepared for Analyzer', {
      discussionId,
      roundNumber: currentRoundNumber,
      roundsCount: contextForAnalyzer.rounds?.length || 0,
      note: 'All LLMs see all rounds - no filtering applied',
    });

    const analyzerResponse = await generateAIResponse(
      io,
      discussionId,
      analyzerPersona,
      topic,
      contextForAnalyzer, // All LLMs see all rounds
      isFirstRound,
      files,
      currentRoundNumber,
      userAnswers
    );

    context = updateStateContextWithResponse(context, analyzerPersona, analyzerResponse);
    logger.info('✅ STEP 4 COMPLETE: Analyzer AI response generated', {
      discussionId,
      roundNumber: currentRoundNumber,
      turn: analyzerResponse.turn,
    });
  } catch (error) {
    const analyzerError = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to generate Analyzer response', {
      discussionId,
      roundNumber: currentRoundNumber,
      error: analyzerError.message,
    });
    return {
      round: {} as DiscussionRound,
      context: { ...context, state: 'ERROR', error: analyzerError },
      success: false,
      error: analyzerError,
    };
  }

  // Step 5: Process Solver (with validation)
  logger.info('🎯 STEP 5: Processing Solver AI', {
    discussionId,
    roundNumber: currentRoundNumber,
  });
  try {
    const solverPersona = getNextPersona('PROCESSING_SOLVER');
    if (!solverPersona || solverPersona.name !== 'Solver AI') {
      throw new Error(`Invalid Solver persona: ${solverPersona?.name || 'null'}`);
    }

    // Update context to include Analyzer's response for Solver
    const solverResponsePlaceholder: ConversationMessage = {
      discussion_id: discussionId,
      persona: 'Solver AI',
      content: '',
      turn: calculateTurnNumber(currentRoundNumber, 'Solver AI'),
      timestamp: new Date().toISOString(),
      created_at: Date.now(),
    };
    const moderatorResponsePlaceholder: ConversationMessage = {
      discussion_id: discussionId,
      persona: 'Moderator AI',
      content: '',
      turn: calculateTurnNumber(currentRoundNumber, 'Moderator AI'),
      timestamp: new Date().toISOString(),
      created_at: Date.now(),
    };
    const contextWithAnalyzer = {
      ...discussionContext,
      rounds: [
        ...(discussionContext.rounds || []),
        {
          roundNumber: currentRoundNumber,
          analyzerResponse: context.analyzerResponse!,
          solverResponse: solverResponsePlaceholder,
          moderatorResponse: moderatorResponsePlaceholder,
          timestamp: new Date().toISOString(),
        } as DiscussionRound,
      ],
    };

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

    context = updateStateContextWithResponse(context, solverPersona, solverResponse);
    logger.info('✅ STEP 5 COMPLETE: Solver AI response generated', {
      discussionId,
      roundNumber: currentRoundNumber,
      turn: solverResponse.turn,
    });
  } catch (error) {
    const solverError = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to generate Solver response', {
      discussionId,
      roundNumber: currentRoundNumber,
      error: solverError.message,
    });
    return {
      round: {} as DiscussionRound,
      context: { ...context, state: 'ERROR', error: solverError },
      success: false,
      error: solverError,
    };
  }

  // Step 6: Process Moderator (with validation)
  logger.info('🎯 STEP 6: Processing Moderator AI', {
    discussionId,
    roundNumber: currentRoundNumber,
  });
  try {
    const moderatorPersona = getNextPersona('PROCESSING_MODERATOR');
    if (!moderatorPersona || moderatorPersona.name !== 'Moderator AI') {
      throw new Error(`Invalid Moderator persona: ${moderatorPersona?.name || 'null'}`);
    }

    // Update context to include Analyzer's and Solver's responses for Moderator
    const moderatorResponsePlaceholder2: ConversationMessage = {
      discussion_id: discussionId,
      persona: 'Moderator AI',
      content: '',
      turn: calculateTurnNumber(currentRoundNumber, 'Moderator AI'),
      timestamp: new Date().toISOString(),
      created_at: Date.now(),
    };
    const contextWithBoth = {
      ...discussionContext,
      rounds: [
        ...(discussionContext.rounds || []),
        {
          roundNumber: currentRoundNumber,
          analyzerResponse: context.analyzerResponse!,
          solverResponse: context.solverResponse!,
          moderatorResponse: moderatorResponsePlaceholder2,
          timestamp: new Date().toISOString(),
        } as DiscussionRound,
      ],
    };

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

    context = updateStateContextWithResponse(context, moderatorPersona, moderatorResponse);
    logger.info('✅ STEP 6 COMPLETE: Moderator AI response generated', {
      discussionId,
      roundNumber: currentRoundNumber,
      turn: moderatorResponse.turn,
    });
  } catch (error) {
    const moderatorError = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to generate Moderator response', {
      discussionId,
      roundNumber: currentRoundNumber,
      error: moderatorError.message,
    });
    return {
      round: {} as DiscussionRound,
      context: { ...context, state: 'ERROR', error: moderatorError },
      success: false,
      error: moderatorError,
    };
  }

  // Step 7: Validate round completeness
  logger.info('🎯 STEP 7: Validating round completeness', {
    discussionId,
    roundNumber: currentRoundNumber,
  });
  const finalValidation = validateFinalRound(context);
  if (!finalValidation.isValid) {
    const error = new Error(`Final round validation failed: ${finalValidation.message}`);
    logger.error('Final round validation failed', {
      discussionId,
      roundNumber: currentRoundNumber,
      errors: finalValidation.errors,
    });
    return {
      round: {} as DiscussionRound,
      context: { ...context, state: 'ERROR', error },
      success: false,
      error,
    };
  }

  // Step 8: Create final round object
  const round: DiscussionRound = {
    roundNumber: currentRoundNumber,
    analyzerResponse: context.analyzerResponse!,
    solverResponse: context.solverResponse!,
    moderatorResponse: context.moderatorResponse!,
    timestamp: new Date().toISOString(),
  };

  logger.info('✅ ROUND ORCHESTRATOR: Round execution completed successfully', {
    discussionId,
    roundNumber: currentRoundNumber,
    state: context.state,
    timestamp: new Date().toISOString(),
  });

  return {
    round,
    context,
    success: true,
  };
}
