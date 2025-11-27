/**
 * Round Validator
 * Centralizes all validation logic for rounds, personas, and responses
 * Ensures consistent validation behavior across the codebase
 */

import type { DiscussionRound, ConversationMessage } from '@/types';
import { calculateTurnNumber, getPersonaFromTurnNumber } from './round-utils';

export interface ValidationResult {
  isValid: boolean;
  message: string;
  errors?: string[];
}

/**
 * Validate persona execution order
 * Ensures personas execute in correct order: Analyzer → Solver → Moderator
 */
export function validatePersonaExecutionOrder(
  personas: Array<'Analyzer AI' | 'Solver AI' | 'Moderator AI'>,
  turns: number[]
): ValidationResult {
  const errors: string[] = [];

  if (personas.length !== turns.length) {
    errors.push(`Persona count (${personas.length}) does not match turn count (${turns.length})`);
    return {
      isValid: false,
      message: 'Persona and turn count mismatch',
      errors,
    };
  }

  const expectedOrder: Array<'Analyzer AI' | 'Solver AI' | 'Moderator AI'> = [
    'Analyzer AI',
    'Solver AI',
    'Moderator AI',
  ];

  for (let i = 0; i < personas.length; i++) {
    const expectedPersona = expectedOrder[i % 3];
    if (personas[i] !== expectedPersona) {
      errors.push(
        `Position ${i}: Expected ${expectedPersona}, got ${personas[i]}`
      );
    }

    // Validate turn number matches persona position
    const expectedTurn = calculateTurnNumber(Math.floor(i / 3) + 1, expectedPersona);
    if (turns[i] !== expectedTurn) {
      errors.push(
        `Position ${i}: Turn number ${turns[i]} does not match expected ${expectedTurn} for ${expectedPersona}`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    message: errors.length === 0 ? 'Persona execution order is valid' : 'Persona execution order validation failed',
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Validate turn numbers in a round
 * Ensures turn numbers match expected values based on round number and persona
 */
export function validateTurnNumbers(
  round: DiscussionRound,
  expectedTurns: { analyzer: number; solver: number; moderator: number }
): ValidationResult {
  const errors: string[] = [];

  if (round.analyzerResponse?.turn !== expectedTurns.analyzer) {
    errors.push(
      `Analyzer turn ${round.analyzerResponse?.turn} does not match expected ${expectedTurns.analyzer}`
    );
  }

  if (round.solverResponse?.turn !== expectedTurns.solver) {
    errors.push(
      `Solver turn ${round.solverResponse?.turn} does not match expected ${expectedTurns.solver}`
    );
  }

  if (round.moderatorResponse?.turn !== expectedTurns.moderator) {
    errors.push(
      `Moderator turn ${round.moderatorResponse?.turn} does not match expected ${expectedTurns.moderator}`
    );
  }

  return {
    isValid: errors.length === 0,
    message: errors.length === 0 ? 'Turn numbers are valid' : 'Turn number validation failed',
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Validate response completeness
 * Checks if response length matches expected length (within tolerance)
 */
export function validateResponseCompleteness(
  response: string,
  expectedLength: number,
  tolerance: number = 0.1 // 10% tolerance
): ValidationResult {
  const actualLength = response.length;
  const lengthDifference = Math.abs(actualLength - expectedLength);
  const toleranceValue = Math.max(10, Math.floor(expectedLength * tolerance));

  if (lengthDifference > toleranceValue) {
    return {
      isValid: false,
      message: `Response length ${actualLength} does not match expected ${expectedLength} (difference: ${lengthDifference}, tolerance: ${toleranceValue})`,
    };
  }

  return {
    isValid: true,
    message: `Response length matches expected (difference: ${lengthDifference}, within tolerance: ${toleranceValue})`,
  };
}

/**
 * Validate round completeness
 * Ensures all three responses exist and have content
 */
export function validateRoundCompleteness(round: DiscussionRound): ValidationResult {
  const errors: string[] = [];

  if (!round.analyzerResponse?.content || round.analyzerResponse.content.trim().length === 0) {
    errors.push('Analyzer response is missing or empty');
  }

  if (!round.solverResponse?.content || round.solverResponse.content.trim().length === 0) {
    errors.push('Solver response is missing or empty');
  }

  if (!round.moderatorResponse?.content || round.moderatorResponse.content.trim().length === 0) {
    errors.push('Moderator response is missing or empty');
  }

  // Validate turn numbers are sequential
  const turns = [
    round.analyzerResponse?.turn,
    round.solverResponse?.turn,
    round.moderatorResponse?.turn,
  ].filter((t): t is number => t !== undefined);

  if (turns.length === 3) {
    const expectedAnalyzerTurn = calculateTurnNumber(round.roundNumber, 'Analyzer AI');
    const expectedSolverTurn = calculateTurnNumber(round.roundNumber, 'Solver AI');
    const expectedModeratorTurn = calculateTurnNumber(round.roundNumber, 'Moderator AI');

    if (turns[0] !== expectedAnalyzerTurn) {
      errors.push(`Analyzer turn ${turns[0]} does not match expected ${expectedAnalyzerTurn}`);
    }
    if (turns[1] !== expectedSolverTurn) {
      errors.push(`Solver turn ${turns[1]} does not match expected ${expectedSolverTurn}`);
    }
    if (turns[2] !== expectedModeratorTurn) {
      errors.push(`Moderator turn ${turns[2]} does not match expected ${expectedModeratorTurn}`);
    }

    // Validate turns are sequential
    if (turns[1] !== turns[0] + 1 || turns[2] !== turns[1] + 1) {
      errors.push(`Turns are not sequential: ${turns.join(', ')}`);
    }
  }

  return {
    isValid: errors.length === 0,
    message: errors.length === 0 ? 'Round is complete and valid' : 'Round completeness validation failed',
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Validate persona execution order (single persona validation)
 * Ensures personas execute in correct order: Analyzer → Solver → Moderator
 * Used for validating a single persona against the last message persona
 * @param currentPersona - The persona currently executing
 * @param lastMessagePersona - The persona of the last message (null if first message)
 * @param isFirstMessage - Whether this is the first message in the discussion
 * @returns Validation result with isValid flag and error message if invalid
 */
export function validatePersonaOrder(
  currentPersona: string,
  lastMessagePersona: string | null,
  isFirstMessage: boolean
): { isValid: boolean; message: string } {
  // First message must be Analyzer AI
  if (isFirstMessage) {
    if (currentPersona !== 'Analyzer AI') {
      return {
        isValid: false,
        message: `First message must be from Analyzer AI, but got ${currentPersona}`,
      };
    }
    return { isValid: true, message: 'Valid: First message from Analyzer AI' };
  }

  // If no last message, this should be Analyzer (first in round)
  if (!lastMessagePersona) {
    if (currentPersona !== 'Analyzer AI') {
      return {
        isValid: false,
        message: `First message in round must be from Analyzer AI, but got ${currentPersona}`,
      };
    }
    return { isValid: true, message: 'Valid: Analyzer AI starting new round' };
  }

  // Define correct order
  const order: Record<string, string | null> = {
    'Analyzer AI': 'Solver AI',
    'Solver AI': 'Moderator AI',
    'Moderator AI': 'Analyzer AI', // Next round starts with Analyzer
  };

  const expectedNext = order[lastMessagePersona];
  if (expectedNext && currentPersona !== expectedNext) {
    // Special case: If last was Moderator, next should be Analyzer (new round)
    if (lastMessagePersona === 'Moderator AI' && currentPersona === 'Analyzer AI') {
      return { isValid: true, message: 'Valid: Analyzer AI starting new round after Moderator' };
    }
    return {
      isValid: false,
      message: `Invalid persona order: Expected ${expectedNext} after ${lastMessagePersona}, but got ${currentPersona}`,
    };
  }

  return { isValid: true, message: `Valid: ${currentPersona} follows ${lastMessagePersona} correctly` };
}

/**
 * Validate message ordering
 * Ensures messages are in correct order based on turn numbers
 */
export function validateMessageOrdering(messages: ConversationMessage[]): ValidationResult {
  const errors: string[] = [];

  if (messages.length === 0) {
    return { isValid: true, message: 'No messages to validate' };
  }

  // Sort by turn number
  const sortedMessages = [...messages].sort((a, b) => a.turn - b.turn);

  // Check for duplicate turn numbers
  const turnNumbers = sortedMessages.map((m) => m.turn);
  const duplicates = turnNumbers.filter((num, index) => turnNumbers.indexOf(num) !== index);
  if (duplicates.length > 0) {
    errors.push(`Duplicate turn numbers found: ${[...new Set(duplicates)].join(', ')}`);
  }

  // Check for gaps in turn sequence
  for (let i = 1; i < sortedMessages.length; i++) {
    const expectedTurn = sortedMessages[i - 1].turn + 1;
    if (sortedMessages[i].turn !== expectedTurn) {
      errors.push(
        `Gap in turn sequence: Expected turn ${expectedTurn} after turn ${sortedMessages[i - 1].turn}, got ${sortedMessages[i].turn}`
      );
    }
  }

  // Validate persona order matches turn order
  for (let i = 0; i < sortedMessages.length; i++) {
    const expectedPersona = getPersonaFromTurnNumber(sortedMessages[i].turn);
    if (sortedMessages[i].persona !== expectedPersona) {
      errors.push(
        `Turn ${sortedMessages[i].turn}: Expected persona ${expectedPersona}, got ${sortedMessages[i].persona}`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    message: errors.length === 0 ? 'Message ordering is valid' : 'Message ordering validation failed',
    errors: errors.length > 0 ? errors : undefined,
  };
}
