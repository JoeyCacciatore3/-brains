# Round Utilities Documentation

## Overview

The round utilities module (`src/lib/discussions/round-utils.ts`) provides centralized functions for handling rounds, ensuring consistency and correctness across the codebase.

## Round States

### Complete Rounds

A round is **complete** when all three AI personas have provided responses:
- Analyzer AI response exists and has content
- Solver AI response exists and has content
- Moderator AI response exists and has content

**Use case**: Complete rounds are included in context when Analyzer starts a new round.

### Empty Rounds

A round is **empty** when no AI persona has provided any content:
- No Analyzer AI response content
- No Solver AI response content
- No Moderator AI response content

**Use case**: Empty rounds are used for Round 1 initialization before any responses are generated.

### Incomplete Rounds

A round is **incomplete** when some (but not all) AI personas have provided responses:
- At least one response exists
- Not all three responses exist

**Use case**: Incomplete rounds are filtered out when Analyzer starts a new round to prevent context issues.

## Key Functions

### `isRoundComplete(round: DiscussionRound): boolean`

Checks if a round has all three responses with content.

### `isRoundEmpty(round: DiscussionRound): boolean`

Checks if a round has no content in any response.

### `isRoundIncomplete(round: DiscussionRound): boolean`

Checks if a round has some but not all responses.

### `filterCompleteRounds(rounds: DiscussionRound[]): DiscussionRound[]`

Filters rounds to only include complete rounds and empty rounds. Excludes incomplete rounds.

**Critical**: This function is used when Analyzer starts a new round to ensure it never sees incomplete rounds with Solver responses.

### `sortRoundsByRoundNumber(rounds: DiscussionRound[]): DiscussionRound[]`

Sorts rounds by roundNumber in ascending order. Ensures consistent ordering after reading from file.

### `validateRoundsSorted(rounds: DiscussionRound[]): boolean`

Validates that rounds are sorted by roundNumber.

### `validateRoundNumberSequence(rounds: DiscussionRound[]): { isValid: boolean; errors: string[] }`

Validates round number sequence integrity:
- No gaps in sequence
- No duplicate round numbers
- Sequence starts at 1
- All round numbers are positive integers

### `validateNewRoundNumber(rounds: DiscussionRound[], newRoundNumber: number): { isValid: boolean; error?: string }`

Validates that a new round number matches expected value (rounds.length + 1).

### `calculateTurnNumber(roundNumber: number, persona: 'Analyzer AI' | 'Solver AI' | 'Moderator AI'): number`

Calculates turn number for a persona in a given round.

**Formula**: `(roundNumber - 1) * 3 + position`
- Position 1 = Analyzer AI
- Position 2 = Solver AI
- Position 3 = Moderator AI

**Examples**:
- Round 1, Analyzer: (1-1)*3+1 = 1
- Round 1, Solver: (1-1)*3+2 = 2
- Round 1, Moderator: (1-1)*3+3 = 3
- Round 2, Analyzer: (2-1)*3+1 = 4

## Usage Guidelines

1. **Always sort rounds** after reading from file using `sortRoundsByRoundNumber()`
2. **Filter incomplete rounds** when Analyzer starts a new round using `filterCompleteRounds()`
3. **Use `calculateTurnNumber()`** for all turn number calculations (never inline calculations)
4. **Validate round numbers** before processing using `validateRoundNumberSequence()`
5. **Validate new round numbers** before adding using `validateNewRoundNumber()`

## Round Processing Order

The execution order is **always**:
1. Analyzer AI (first)
2. Solver AI (second)
3. Moderator AI (third)

This order is enforced by:
- Explicit validation in `processSingleRound()`
- Turn number calculation ensures correct sequence
- Context filtering ensures Analyzer never sees Solver responses from incomplete rounds
