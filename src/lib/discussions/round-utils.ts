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
 * CRITICAL: This ensures Analyzer never sees incomplete rounds with Solver responses
 *
 * Rules:
 * - Analyzer: Only sees complete rounds (all 3 responses) to prevent seeing future Solver responses
 * - Solver/Moderator: Can see incomplete rounds in current round (for context during processing)
 *
 * @param rounds - All rounds from discussion context
 * @param personaName - The persona requesting context ('Analyzer AI', 'Solver AI', or 'Moderator AI')
 * @param currentRoundNumber - The current round being processed (for Solver/Moderator to see incomplete current round)
 * @returns Filtered rounds appropriate for the persona's context
 */
export function filterRoundsForPersona(
  rounds: DiscussionRound[],
  personaName: 'Analyzer AI' | 'Solver AI' | 'Moderator AI',
  currentRoundNumber?: number
): DiscussionRound[] {
  if (personaName === 'Analyzer AI') {
    // CRITICAL: Analyzer should ONLY see complete rounds
    // This prevents Analyzer from seeing Solver responses from incomplete rounds

    // CRITICAL AUDIT: Also exclude current round entirely (even if complete)
    // Analyzer should never see the current round it's about to create
    let filtered = filterCompleteRounds(rounds);

    // Remove current round if it exists (shouldn't, but safety check)
    if (currentRoundNumber !== undefined) {
      const beforeCount = filtered.length;
      filtered = filtered.filter((r) => r.roundNumber !== currentRoundNumber);
      if (filtered.length < beforeCount) {
        logger.warn('🚨 CRITICAL: Current round was in context for Analyzer - removed it', {
          currentRoundNumber,
          removedRoundNumber: currentRoundNumber,
          note: 'Analyzer should never see current round - this indicates a bug',
        });
      }
    }

    if (filtered.length !== rounds.length) {
      const incompleteCount = rounds.length - filtered.length;
      logger.info('🔍 Context filtering: Filtered incomplete rounds for Analyzer', {
        originalRoundsCount: rounds.length,
        filteredRoundsCount: filtered.length,
        incompleteRoundsFiltered: incompleteCount,
        currentRoundExcluded: currentRoundNumber !== undefined,
        note: 'Analyzer must only see complete rounds to prevent context contamination',
      });
    }

    // CRITICAL AUDIT: Verify Analyzer sees complete rounds with all three responses (including Solver)
    // This confirms Analyzer can see Solver responses WITHIN complete rounds (which is correct)
    if (filtered.length > 0) {
      const completeRoundsWithSolver = filtered.filter((r) =>
        r.solverResponse?.content?.trim() &&
        r.analyzerResponse?.content?.trim() &&
        r.moderatorResponse?.content?.trim()
      );
      logger.info('✅ AUDIT: Analyzer context includes complete rounds with all three responses', {
        currentRoundNumber,
        completeRoundsCount: filtered.length,
        roundsWithAllThreeResponses: completeRoundsWithSolver.length,
        roundNumbers: filtered.map((r) => r.roundNumber),
        sampleRound: filtered.length > 0 ? {
          roundNumber: filtered[filtered.length - 1].roundNumber,
          hasAnalyzer: !!filtered[filtered.length - 1].analyzerResponse?.content?.trim(),
          hasSolver: !!filtered[filtered.length - 1].solverResponse?.content?.trim(),
          hasModerator: !!filtered[filtered.length - 1].moderatorResponse?.content?.trim(),
          solverContentPreview: filtered[filtered.length - 1].solverResponse?.content?.substring(0, 50),
          note: 'Analyzer correctly sees Solver responses within complete rounds',
        } : null,
      });
    }

    return filtered;
  } else {
    // Solver and Moderator can see incomplete rounds in the current round
    // Filter out incomplete rounds from previous rounds, but keep current round if incomplete
    return rounds.filter((round) => {
      if (isRoundComplete(round) || isRoundEmpty(round)) {
        return true; // Include complete or empty rounds
      }

      // Include incomplete round only if it's the current round being processed
      if (currentRoundNumber !== undefined && round.roundNumber === currentRoundNumber) {
        return true; // Solver/Moderator can see incomplete current round
      }

      // Exclude incomplete rounds from previous rounds
      return false;
    });
  }
}
