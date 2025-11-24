/**
 * Round Processor State Machine
 * Centralizes round processing logic with clear state transitions
 * Prevents out-of-order execution and provides clear error handling
 */

import type { Server } from 'socket.io';
import type { DiscussionRound, FileData, ConversationMessage } from '@/types';
import { logger } from '@/lib/logger';
import { aiPersonas } from '@/lib/llm';
import type { Persona } from '@/lib/llm';
import { calculateTurnNumber } from './round-utils';
import { validateRoundCompleteness, validateTurnNumbers } from './round-validator';

export type RoundState =
  | 'INITIAL'
  | 'VALIDATING'
  | 'PROCESSING_ANALYZER'
  | 'PROCESSING_SOLVER'
  | 'PROCESSING_MODERATOR'
  | 'COMPLETE'
  | 'ERROR';

export interface RoundStateContext {
  state: RoundState;
  roundNumber: number;
  analyzerResponse?: ConversationMessage;
  solverResponse?: ConversationMessage;
  moderatorResponse?: ConversationMessage;
  error?: Error;
}

export interface ValidationResult {
  isValid: boolean;
  message: string;
  errors?: string[];
}

/**
 * Validate round state before processing
 */
export function validateRoundState(
  roundNumber: number,
  existingRounds: DiscussionRound[]
): ValidationResult {
  const errors: string[] = [];

  // Validate round number is sequential
  const expectedRoundNumber = existingRounds.length + 1;
  if (roundNumber !== expectedRoundNumber) {
    errors.push(
      `Round number ${roundNumber} does not match expected ${expectedRoundNumber} (rounds.length + 1)`
    );
  }

  // Validate no incomplete rounds exist
  const incompleteRounds = existingRounds.filter(
    (r) =>
      (r.analyzerResponse?.content && r.analyzerResponse.content.trim().length > 0) &&
      (!r.solverResponse?.content || r.solverResponse.content.trim().length === 0)
  );
  if (incompleteRounds.length > 0) {
    errors.push(
      `Found ${incompleteRounds.length} incomplete round(s): ${incompleteRounds.map((r) => r.roundNumber).join(', ')}`
    );
  }

  return {
    isValid: errors.length === 0,
    message: errors.length === 0 ? 'Round state is valid' : 'Round state validation failed',
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Get next persona based on current state
 */
export function getNextPersona(currentState: RoundState): Persona | null {
  switch (currentState) {
    case 'INITIAL':
    case 'VALIDATING':
      return aiPersonas.analyzer;
    case 'PROCESSING_ANALYZER':
      return aiPersonas.solver;
    case 'PROCESSING_SOLVER':
      return aiPersonas.moderator;
    case 'PROCESSING_MODERATOR':
      return null; // Round complete
    default:
      return null;
  }
}

/**
 * Validate persona order
 * Ensures current persona follows previous persona correctly
 */
export function validatePersonaOrderInStateMachine(
  currentPersona: Persona,
  previousPersona: Persona | null,
  currentState: RoundState
): ValidationResult {
  const errors: string[] = [];

  // First persona must be Analyzer
  if (!previousPersona && currentPersona.name !== 'Analyzer AI') {
    errors.push(`First persona must be Analyzer AI, got ${currentPersona.name}`);
    return {
      isValid: false,
      message: 'Invalid first persona',
      errors,
    };
  }

  // Validate order: Analyzer → Solver → Moderator
  if (previousPersona) {
    const order: Record<string, string> = {
      'Analyzer AI': 'Solver AI',
      'Solver AI': 'Moderator AI',
    };

    const expectedNext = order[previousPersona.name];
    if (expectedNext && currentPersona.name !== expectedNext) {
      errors.push(
        `Invalid persona order: Expected ${expectedNext} after ${previousPersona.name}, got ${currentPersona.name}`
      );
    }
  }

  // Validate state matches persona
  const statePersonaMap: Record<RoundState, string | null> = {
    INITIAL: null,
    VALIDATING: null,
    PROCESSING_ANALYZER: 'Analyzer AI',
    PROCESSING_SOLVER: 'Solver AI',
    PROCESSING_MODERATOR: 'Moderator AI',
    COMPLETE: null,
    ERROR: null,
  };

  const expectedPersonaForState = statePersonaMap[currentState];
  if (expectedPersonaForState && currentPersona.name !== expectedPersonaForState) {
    errors.push(
      `State ${currentState} expects persona ${expectedPersonaForState}, got ${currentPersona.name}`
    );
  }

  return {
    isValid: errors.length === 0,
    message: errors.length === 0 ? 'Persona order is valid' : 'Persona order validation failed',
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Transition to next state
 */
export function transitionToNextState(currentState: RoundState): RoundState {
  const transitions: Record<RoundState, RoundState> = {
    INITIAL: 'VALIDATING',
    VALIDATING: 'PROCESSING_ANALYZER',
    PROCESSING_ANALYZER: 'PROCESSING_SOLVER',
    PROCESSING_SOLVER: 'PROCESSING_MODERATOR',
    PROCESSING_MODERATOR: 'COMPLETE',
    COMPLETE: 'COMPLETE', // Terminal state
    ERROR: 'ERROR', // Terminal state
  };

  return transitions[currentState] || 'ERROR';
}

/**
 * Create initial state context
 */
export function createInitialStateContext(roundNumber: number): RoundStateContext {
  return {
    state: 'INITIAL',
    roundNumber,
  };
}

/**
 * Update state context with response
 */
export function updateStateContextWithResponse(
  context: RoundStateContext,
  persona: Persona,
  response: ConversationMessage
): RoundStateContext {
  const updated: RoundStateContext = { ...context };

  switch (persona.name) {
    case 'Analyzer AI':
      updated.analyzerResponse = response;
      updated.state = 'PROCESSING_SOLVER';
      break;
    case 'Solver AI':
      updated.solverResponse = response;
      updated.state = 'PROCESSING_MODERATOR';
      break;
    case 'Moderator AI':
      updated.moderatorResponse = response;
      updated.state = 'COMPLETE';
      break;
    default:
      updated.state = 'ERROR';
      updated.error = new Error(`Unknown persona: ${persona.name}`);
  }

  return updated;
}

/**
 * Validate final round before completion
 */
export function validateFinalRound(context: RoundStateContext): ValidationResult {
  if (context.state !== 'COMPLETE') {
    return {
      isValid: false,
      message: `Round is not complete (state: ${context.state})`,
    };
  }

  if (!context.analyzerResponse || !context.solverResponse || !context.moderatorResponse) {
    return {
      isValid: false,
      message: 'Round is missing one or more responses',
    };
  }

  const round: DiscussionRound = {
    roundNumber: context.roundNumber,
    analyzerResponse: context.analyzerResponse,
    solverResponse: context.solverResponse,
    moderatorResponse: context.moderatorResponse,
    timestamp: new Date().toISOString(),
  };

  // Validate round completeness
  const completenessValidation = validateRoundCompleteness(round);
  if (!completenessValidation.isValid) {
    return completenessValidation;
  }

  // Validate turn numbers
  const expectedTurns = {
    analyzer: calculateTurnNumber(context.roundNumber, 'Analyzer AI'),
    solver: calculateTurnNumber(context.roundNumber, 'Solver AI'),
    moderator: calculateTurnNumber(context.roundNumber, 'Moderator AI'),
  };

  const turnValidation = validateTurnNumbers(round, expectedTurns);
  if (!turnValidation.isValid) {
    return turnValidation;
  }

  return {
    isValid: true,
    message: 'Final round validation passed',
  };
}
