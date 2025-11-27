/**
 * Round utility functions for filtering, validation, and manipulation
 * Centralized logic for handling rounds to ensure consistency across the codebase
 */

import type { DiscussionRound } from '@/types';
import { logger } from '@/lib/logger';

/**
 * Check if a round is complete (all 3 responses have content)
 */
export function isRoundComplete(round: DiscussionRound): boolean {
  return (
    !!round.analyzerResponse?.content &&
    round.analyzerResponse.content.trim().length > 0 &&
    !!round.solverResponse?.content &&
    round.solverResponse.content.trim().length > 0 &&
    !!round.moderatorResponse?.content &&
    round.moderatorResponse.content.trim().length > 0
  );
}

/**
 * Check if a round is empty (no content in any response)
 * Used for Round 1 initialization
 */
export function isRoundEmpty(round: DiscussionRound): boolean {
  return (
    (!round.analyzerResponse?.content || round.analyzerResponse.content.trim().length === 0) &&
    (!round.solverResponse?.content || round.solverResponse.content.trim().length === 0) &&
    (!round.moderatorResponse?.content || round.moderatorResponse.content.trim().length === 0)
  );
}

/**
 * Check if a round is incomplete (some responses exist but not all three)
 * Incomplete rounds should be filtered out when Analyzer is starting a new round
 */
export function isRoundIncomplete(round: DiscussionRound): boolean {
  const hasAnalyzer = !!round.analyzerResponse?.content && round.analyzerResponse.content.trim().length > 0;
  const hasSolver = !!round.solverResponse?.content && round.solverResponse.content.trim().length > 0;
  const hasModerator = !!round.moderatorResponse?.content && round.moderatorResponse.content.trim().length > 0;

  // Incomplete if at least one response exists but not all three
  const responseCount = [hasAnalyzer, hasSolver, hasModerator].filter(Boolean).length;
  return responseCount > 0 && responseCount < 3;
}

/**
 * Filter rounds to only include complete rounds (all 3 responses)
 * Also includes empty rounds (for Round 1 initialization)
 * Excludes incomplete rounds that could cause context issues
 */
export function filterCompleteRounds(rounds: DiscussionRound[]): DiscussionRound[] {
  return rounds.filter((round) => isRoundComplete(round) || isRoundEmpty(round));
}

/**
 * Filter rounds to only include incomplete rounds
 * Used for detecting and handling partial rounds
 */
export function filterIncompleteRounds(rounds: DiscussionRound[]): DiscussionRound[] {
  return rounds.filter((round) => isRoundIncomplete(round));
}

/**
 * Sort rounds by roundNumber in ascending order
 * Ensures consistent ordering after reading from file
 */
export function sortRoundsByRoundNumber(rounds: DiscussionRound[]): DiscussionRound[] {
  return [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
}

/**
 * Validate that rounds are sorted by roundNumber
 */
export function validateRoundsSorted(rounds: DiscussionRound[]): boolean {
  if (rounds.length <= 1) return true;
  for (let i = 1; i < rounds.length; i++) {
    if (rounds[i].roundNumber < rounds[i - 1].roundNumber) {
      return false;
    }
  }
  return true;
}

/**
 * Validate round number sequence integrity
 * Checks for:
 * - No gaps in sequence
 * - No duplicate round numbers
 * - Sequence starts at 1
 * - All round numbers are positive integers
 */
export function validateRoundNumberSequence(rounds: DiscussionRound[]): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (rounds.length === 0) {
    return { isValid: true, errors: [] };
  }

  // Sort rounds first to ensure we check in order
  const sortedRounds = sortRoundsByRoundNumber(rounds);

  // Check for duplicate round numbers
  const roundNumbers = sortedRounds.map((r) => r.roundNumber);
  const duplicates = roundNumbers.filter((num, index) => roundNumbers.indexOf(num) !== index);
  if (duplicates.length > 0) {
    errors.push(`Duplicate round numbers found: ${[...new Set(duplicates)].join(', ')}`);
  }

  // Check for gaps in sequence
  const expectedSequence = Array.from({ length: sortedRounds.length }, (_, i) => i + 1);
  const actualSequence = sortedRounds.map((r) => r.roundNumber);
  const gaps = expectedSequence.filter((expected) => !actualSequence.includes(expected));
  if (gaps.length > 0) {
    errors.push(`Gaps in round number sequence: missing rounds ${gaps.join(', ')}`);
  }

  // Check that sequence starts at 1
  if (sortedRounds.length > 0 && sortedRounds[0].roundNumber !== 1) {
    errors.push(`Round sequence does not start at 1 (starts at ${sortedRounds[0].roundNumber})`);
  }

  // Check for invalid round numbers (non-positive, non-integer)
  const invalidNumbers = roundNumbers.filter((num) => !Number.isInteger(num) || num < 1);
  if (invalidNumbers.length > 0) {
    errors.push(`Invalid round numbers found: ${invalidNumbers.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that a new round number matches expected value
 * Expected round number = rounds.length + 1
 */
export function validateNewRoundNumber(rounds: DiscussionRound[], newRoundNumber: number): {
  isValid: boolean;
  error?: string;
} {
  const expectedRoundNumber = rounds.length + 1;
  if (newRoundNumber !== expectedRoundNumber) {
    return {
      isValid: false,
      error: `Round number ${newRoundNumber} does not match expected value ${expectedRoundNumber} (rounds.length + 1)`,
    };
  }
  return { isValid: true };
}

/**
 * Calculate turn number for a persona in a given round
 * Formula: (roundNumber - 1) * 3 + position
 * Position: 1 for Analyzer, 2 for Solver, 3 for Moderator
 */
export function calculateTurnNumber(roundNumber: number, persona: 'Analyzer AI' | 'Solver AI' | 'Moderator AI'): number {
  const positionMap: Record<'Analyzer AI' | 'Solver AI' | 'Moderator AI', number> = {
    'Analyzer AI': 1,
    'Solver AI': 2,
    'Moderator AI': 3,
  };

  const position = positionMap[persona];
  if (!position) {
    logger.warn('Unknown persona in turn number calculation', { persona, roundNumber });
    return (roundNumber - 1) * 3 + 1; // Default to Analyzer position
  }

  return (roundNumber - 1) * 3 + position;
}

/**
 * Get persona from turn number
 * Reverse of calculateTurnNumber
 */
export function getPersonaFromTurnNumber(turnNumber: number): 'Analyzer AI' | 'Solver AI' | 'Moderator AI' {
  const position = ((turnNumber - 1) % 3) + 1;
  switch (position) {
    case 1:
      return 'Analyzer AI';
    case 2:
      return 'Solver AI';
    case 3:
      return 'Moderator AI';
    default:
      logger.warn('Invalid turn number position', { turnNumber, position });
      return 'Analyzer AI';
  }
}

/**
 * Get round number from turn number
 */
export function getRoundNumberFromTurnNumber(turnNumber: number): number {
  return Math.floor((turnNumber - 1) / 3) + 1;
}

/**
 * Filter rounds for a specific persona's context
 *
 * IMPORTANT: ALL LLMs see ALL previous rounds AND the current round.
 * Execution order (Analyzer → Solver → Moderator) is ONLY for generating intelligent discussion,
 * it does NOT affect what context each LLM can see.
 *
 * This function now returns all rounds for all personas. The personaName parameter is kept
 * for backward compatibility but no longer affects filtering.
 *
 * @param rounds - All rounds from discussion context
 * @param personaName - The persona requesting context (kept for backward compatibility, no longer affects filtering)
 * @param currentRoundNumber - The current round being processed (kept for backward compatibility, no longer affects filtering)
 * @returns All rounds (no filtering based on persona)
 */
export function filterRoundsForPersona(
  rounds: DiscussionRound[],
  personaName: 'Analyzer AI' | 'Solver AI' | 'Moderator AI',
  currentRoundNumber?: number
): DiscussionRound[] {
  // ALL LLMs see ALL rounds - no filtering based on persona
  // Execution order is enforced separately and does not affect context visibility
  return rounds;
}
