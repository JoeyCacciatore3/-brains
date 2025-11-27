# LLM Data Storage Architecture

**Date:** December 2024
**Status:** Current Architecture Documentation

## Overview

This document describes the complete data storage architecture for the LLM discussion system, including how data flows from round creation through storage to LLM context loading.

## Single Source of Truth

### Files (JSON) - Authoritative Source
- **Location**: `data/discussions/{userId}/{discussionId}.json`
- **Content**: Complete discussion history including:
  - All rounds (complete discussion history)
  - All summaries with metadata
  - All question sets
  - User answers
  - Metadata (topic, timestamps, etc.)

### Database - Metadata Only
- **Location**: SQLite database (`data/conversations.db`)
- **Content**: Metadata only:
  - `token_count` - Synced from file
  - `summary` - Legacy summary field (synced from file)
  - `is_resolved` - Resolution status
  - `needs_user_input` - User input flags
  - `current_turn` - Current turn number
  - File paths (JSON and MD)

### Sync Direction
- **File → Database**: Files are authoritative, database is synced from files
- **Sync Function**: `syncTokenCountFromFile()` in `src/lib/db/discussions.ts`
- **Reconciliation**: `reconcileDiscussion()` in `src/lib/discussions/reconciliation.ts`

## Data Flow

### 1. Round Creation
```
User Input → processDiscussionDialogueRoundsInternal()
  → processSingleRound()
    → Analyzer AI response (first)
    → Solver AI response (second)
    → Moderator AI response (third)
  → saveRoundAndEmitEvents()
```

**Key Points:**
- All 3 AI responses are generated in order: Analyzer → Solver → Moderator
- Round is only saved after all 3 responses complete
- Execution order is enforced separately from context visibility

### 2. Round Saving
```
saveRoundAndEmitEvents()
  → addRoundToDiscussion()
    → readDiscussion() - Loads ALL existing rounds
    → Validate round number, turn numbers, personas
    → Add new round to rounds array
    → Sort rounds by roundNumber
    → formatDiscussionJSON() - Saves ALL rounds to JSON
    → formatDiscussionMarkdown() - Saves to MD file
    → writeDiscussionFilesAtomically() - Atomic write
  → syncTokenCountFromFile() - Sync to database
```

**Key Points:**
- ALL rounds are saved to JSON file (complete history)
- Rounds are sorted by roundNumber after each save
- Turn numbers and personas are validated before saving
- Atomic writes ensure JSON and MD files stay in sync

### 3. Context Loading
```
loadDiscussionContext()
  → readDiscussion() - Loads ALL rounds from JSON file
    → parseDiscussionJSON() - Parses JSON
    → sortRoundsByRoundNumber() - Ensures consistent order
  → Calculate token count (includes all rounds or summary + rounds after)
  → Return all rounds in discussionContext.rounds
```

**Key Points:**
- ALL rounds are loaded from JSON file
- Rounds are sorted after loading
- Token count calculation accounts for summaries
- Returns complete discussion history

### 4. Prompt Formatting
```
formatLLMPrompt()
  → Load all rounds from discussionContext
  → Apply summary filtering (if summary exists, only rounds after summary)
  → Include ALL rounds for ALL personas (no persona-specific filtering)
  → Format rounds into conversation transcript
  → Build prompt with summary, rounds, user answers, files
```

**Key Points:**
- ALL LLMs see ALL previous rounds AND current round
- Summary filtering applies to all personas equally
- No persona-specific filtering (removed Analyzer filtering)
- Execution order doesn't affect context visibility

## Context Visibility Rules

### CRITICAL: All LLMs See All Rounds

**Rule**: ALL LLMs (Analyzer, Solver, Moderator) see ALL previous rounds AND the current round.

**Rationale**:
- Execution order (Analyzer → Solver → Moderator) is ONLY for generating intelligent discussion
- Execution order does NOT affect what context each LLM can see
- All LLMs need full context to generate coherent, context-aware responses

### Summary Filtering

**Rule**: If a summary exists, only rounds after the summary are included in context.

**Applies to**: All personas equally

**Logic**:
- If `currentSummary` exists: Include summary + rounds where `roundNumber > currentSummary.roundNumber`
- If no summary: Include ALL rounds from JSON file

### Round Filtering (REMOVED)

**Previous Behavior** (REMOVED):
- Analyzer: Only saw complete rounds (excluded current round)
- Solver/Moderator: Saw all complete + current incomplete round

**Current Behavior**:
- All personas: See ALL rounds (complete, incomplete, and current)
- No filtering based on persona

## Round Storage Details

### Round Structure
```typescript
interface DiscussionRound {
  roundNumber: number;
  timestamp: number;
  analyzerResponse: ConversationMessage;
  solverResponse: ConversationMessage;
  moderatorResponse: ConversationMessage;
  questions?: QuestionSet;
  userAnswers?: string[];
}
```

### Round Validation
Before saving, rounds are validated:
- Round number matches expected value (`rounds.length + 1`)
- Turn numbers match expected values (calculated from roundNumber and persona)
- Personas match expected values ('Analyzer AI', 'Solver AI', 'Moderator AI')
- All three responses have content

### Round Sorting
- Rounds are sorted by `roundNumber` after:
  - Loading from file (`readDiscussion()`)
  - Adding new round (`addRoundToDiscussion()`)
- Ensures consistent order for LLM context

## Summary Storage Details

### Summary Structure
```typescript
interface SummaryEntry {
  roundNumber: number;
  summary: string;
  replacesRounds: number[];
  tokenCountBefore: number;
  tokenCountAfter: number;
  createdAt: number;
}
```

### Summary Handling
- All summaries are stored in `summaries` array
- `currentSummary` points to most recent summary
- Legacy `summary` field maintained for backward compatibility
- Summary prevents duplication in prompts (checks if currentSummary is in summaries array)

## Token Counting

### Token Estimation
- **Standard**: 3.5 characters per token (centralized in `estimateTokensFromChars()`)
- **Location**: `src/lib/discussions/token-counter.ts`
- **Used by**: All components for consistent token counting

### Token Count Calculation
Includes:
- All three responses per round (Analyzer, Solver, Moderator)
- System prompts (max of all three personas, ~250 tokens each)
- Formatting overhead (~75 tokens per round)
- Summary tokens (if summary exists)

### Token Count Sync
- File storage calculates token count from rounds
- Database `token_count` is synced from file
- Reconciliation function validates and repairs mismatches

## Database-File Synchronization

### Sync Points
1. After round save: `syncTokenCountFromFile()` called
2. After summary add: Token count updated
3. On context load: Optional validation (if `ENABLE_TOKEN_SYNC_VALIDATION=true`)

### Reconciliation
- `reconcileDiscussion()`: Syncs database from file
- `validateTokenCountSync()`: Validates sync, optionally auto-repairs
- Auto-repair: Repairs mismatches < 5% difference (if enabled)

## Execution Order vs Context Visibility

### Execution Order (Enforced)
- **Purpose**: Ensure responses are generated in correct order
- **Order**: Analyzer → Solver → Moderator
- **Enforcement**:
  - `validatePersonaCanExecute()` checks order
  - `round-orchestrator.ts` enforces sequential execution
  - Turn number validation ensures correct sequence

### Context Visibility (No Filtering)
- **Purpose**: Provide full context to all LLMs
- **Rule**: ALL LLMs see ALL rounds
- **Implementation**: No filtering based on persona

**Key Distinction**: Execution order is about WHEN responses are generated, not WHAT context is visible.

## File Operations

### Atomic Writes
- `writeDiscussionFilesAtomically()` ensures JSON and MD files are written together
- Uses temp files + rename pattern
- Both files must succeed or both fail

### File Locking
- `withLock()` prevents concurrent modifications
- Uses Redis + in-memory fallback
- Retry logic with exponential backoff

### Error Handling
- Retry logic for transient errors
- Permanent errors fail fast
- Cleanup of temp files on error

## Verification Checklist

When making changes to data storage:

- [ ] All rounds are saved to JSON file (complete history)
- [ ] Rounds are sorted by roundNumber after save
- [ ] Turn numbers are validated before saving
- [ ] Personas are validated before saving
- [ ] Atomic writes ensure JSON and MD stay in sync
- [ ] ALL rounds are loaded from JSON file
- [ ] ALL LLMs see ALL rounds (no persona filtering)
- [ ] Summary filtering works correctly (rounds after summary)
- [ ] Token counting is accurate and consistent
- [ ] Database sync happens after file writes
- [ ] Reconciliation can detect and repair mismatches

## Related Documentation

- [LLM_CONTEXT_REVIEW.md](./LLM_CONTEXT_REVIEW.md) - Detailed context review
- [LLM_SYSTEM_REVIEW.md](./LLM_SYSTEM_REVIEW.md) - Complete system review
- [LLM_WORKFLOW.md](./LLM_WORKFLOW.md) - Workflow documentation
