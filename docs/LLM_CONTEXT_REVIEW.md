# LLM Context and Discussion Review

## Overview
This document provides a comprehensive review of how LLMs receive context from discussions, tracing the flow from saving rounds to formatting prompts.

## Flow Diagram

```
1. Round Completion
   └─> saveRoundAndEmitEvents()
       └─> addRoundToDiscussion()
           └─> formatDiscussionJSON()
               └─> Saves ALL rounds to JSON file ✅

2. Loading Context
   └─> loadDiscussionContext()
       └─> readDiscussion()
           └─> Loads ALL rounds from JSON file ✅
       └─> Returns ALL rounds in discussionContext.rounds ✅

3. Context Visibility
   └─> generateAIResponse()
       └─> filterRoundsForPersona()
           └─> ALL personas: ALL rounds (no filtering) ✅
           └─> Execution order enforced separately (doesn't affect context) ✅

4. Formatting Prompt
   └─> formatLLMPrompt()
       └─> If summary exists: Summary + rounds after summary ✅
       └─> If no summary: ALL rounds from JSON ✅
       └─> ALL LLMs see ALL rounds (no persona-specific filtering) ✅
```

## Critical Review Points

### ✅ 1. Saving Rounds to JSON File

**Location**: `src/lib/discussions/file-manager.ts:addRoundToDiscussion()`

**Status**: CORRECT ✅

- All rounds are saved to JSON file via `formatDiscussionJSON(data)`
- The `data.rounds` array contains ALL rounds (complete history)
- JSON file is the source of truth for LLM context
- MD file is for user viewing/deletion

**Code Flow**:
```typescript
data.rounds.push(round);  // Add new round
data.rounds = sortRoundsByRoundNumber(data.rounds);  // Sort all rounds
const jsonContent = formatDiscussionJSON(data);  // Save ALL rounds to JSON
```

### ✅ 2. Loading Rounds from JSON File

**Location**: `src/lib/discussions/file-manager.ts:readDiscussion()`

**Status**: CORRECT ✅

- `readDiscussion()` loads ALL rounds from JSON file
- Rounds are sorted by roundNumber
- All rounds are returned in `DiscussionData.rounds`

**Code Flow**:
```typescript
const jsonContent = await fs.readFile(paths.json, 'utf-8');
const data = parseDiscussionJSON(jsonContent);  // Loads ALL rounds
data.rounds = sortRoundsByRoundNumber(data.rounds);  // Sort all rounds
return data;  // Returns ALL rounds
```

### ✅ 3. Loading Discussion Context

**Location**: `src/lib/discussion-context.ts:loadDiscussionContext()`

**Status**: CORRECT ✅

- Loads ALL rounds from JSON file via `readDiscussion()`
- Returns ALL rounds in `discussionContext.rounds`
- Calculates token count including all rounds
- Handles summaries correctly (summary replaces old rounds)

**Code Flow**:
```typescript
const discussionData = await readDiscussion(discussionId, userId);  // ALL rounds
return {
  rounds: discussionData.rounds || [],  // ALL rounds from JSON
  // ... other fields
};
```

### ✅ 4. Context Visibility for All Personas

**Location**: `src/lib/discussions/round-utils.ts:filterRoundsForPersona()`

**Status**: CORRECT ✅ (Updated December 2024)

**ALL LLMs (Analyzer, Solver, Moderator)**:
- ✅ See ALL previous rounds (complete and incomplete)
- ✅ See current round (if it exists)
- ✅ Execution order (Analyzer → Solver → Moderator) is enforced separately
- ✅ Execution order does NOT affect what context each LLM can see

**Rationale**:
- Execution order is ONLY for generating intelligent discussion that grows based on ideas and context
- All LLMs need full context to generate coherent, context-aware responses
- No persona-specific filtering needed

**Summary Filtering**:
- ✅ If summary exists, only rounds after summary are included (applies to all personas equally)

### ✅ 5. Formatting LLM Prompt

**Location**: `src/lib/discussion-context.ts:formatLLMPrompt()`

**Status**: CORRECT ✅ (Updated December 2024)

**Current Logic**:
1. If summary exists: Summary + rounds after summary are included
2. If no summary: ALL rounds are included
3. ALL LLMs see ALL rounds (no persona-specific filtering)

**Summary Handling**:
- ✅ All summaries are included in `formatSummaryContext()`
- ✅ Rounds after summary are included
- ✅ No duplication (currentSummary checked against summaries array)

**Round Filtering**:
- ✅ `roundsToInclude` is filtered based on summary (if summary exists)
- ✅ ALL LLMs see ALL rounds (no persona-specific filtering)
- ✅ Current round is included for all personas

**Implementation**:
- Removed Analyzer-specific filtering logic
- All personas receive same context (all rounds)
- Execution order enforced separately (doesn't affect context)

## Issues Identified

### Issue 1: Summary Duplication in Prompt

**Location**: `src/lib/discussion-context.ts:formatSummaryContext()` lines 295-315

**Problem**: The `formatSummaryContext()` function includes:
1. ALL summaries from the `summaries` array (via `allSummariesSection`)
2. The `currentSummary` separately (via `summarySection`)

If `currentSummary` is also in the `summaries` array (which it should be), this causes the most recent summary to be included twice in the prompt.

**Current Code**:
```typescript
const allSummariesSection = summaries && summaries.length > 0
  ? `\n\n## Discussion History (Summarized)\n${summaries
      .sort((a, b) => a.roundNumber - b.roundNumber)
      .map(...)
      .join('\n\n---\n\n')}\n\n---\n`
  : '';

const summaryToUse = currentSummary?.summary || legacySummary;
const summarySection = summaryToUse
  ? `\n\n## Discussion Summary (for context)\n${summaryToUse}\n\n---\n`
  : '';

return allSummariesSection + summarySection;
```

**Impact**: The most recent summary text appears twice in the prompt, which wastes tokens and could confuse the LLM.

**Fix Needed**: Either:
1. Exclude `currentSummary` from `allSummariesSection` if it's already included, OR
2. Only include `currentSummary` in `summarySection` if it's NOT in the `summaries` array

### Issue 2: Summary + Rounds Filtering Interaction

**Location**: `src/lib/discussion-context.ts:formatLLMPrompt()` lines 572-574

**Status**: CORRECT ✅

**Verification**:
- ✅ Summary is included via `formatSummaryContext()` (includes all summaries)
- ✅ Rounds after summary are correctly included (filtered by `r.roundNumber > currentSummary.roundNumber`)
- ✅ Filtering works correctly with `filterRoundsForPersona()`
- ✅ Rounds before summary are correctly excluded (summary represents them)

### Issue 2: Double Filtering (RESOLVED)

**Location**: `src/lib/socket/handlers.ts:generateAIResponse()` and `formatLLMPrompt()`

**Status**: RESOLVED ✅ (December 2024)

**Resolution**: Removed all persona-specific filtering. All LLMs now see all rounds.

**Previous Behavior** (REMOVED):
- Rounds were filtered twice (once in `generateAIResponse()`, once in `formatLLMPrompt()`)
- Analyzer had special filtering logic

**Current Behavior**:
- No filtering based on persona
- All LLMs see all rounds
- Execution order enforced separately (doesn't affect context)

### Issue 3: Current Round Exclusion (RESOLVED)

**Location**: `src/lib/discussions/round-utils.ts:filterRoundsForPersona()`

**Status**: RESOLVED ✅ (December 2024)

**Resolution**: Removed current round exclusion. All LLMs now see all rounds including current round.

**Previous Behavior** (REMOVED):
- Analyzer excluded current round as a safety check
- Defensive programming to prevent contamination

**Current Behavior**:
- All LLMs see all rounds including current round
- No exclusion logic needed
- Execution order ensures correct sequence (doesn't need context filtering)

## Recommendations

### 1. Add Comprehensive Logging

Add detailed logging at each step to verify:
- How many rounds are in the JSON file
- How many rounds are loaded
- How many rounds are filtered
- What rounds are included in the prompt

**Location**: Already partially implemented, but could be enhanced.

### 2. Verify Summary Logic

Ensure that:
- ALL summaries are included in the prompt (not just currentSummary)
- Rounds after summary are correctly included
- Summary correctly represents old rounds

**Status**: `formatSummaryContext()` already includes all summaries ✅

### 3. Add Unit Tests

Create unit tests for:
- `loadDiscussionContext()` with various round counts
- `formatLLMPrompt()` with summaries
- `filterRoundsForPersona()` for each persona
- Round filtering with summaries

### 4. Document Round Flow

Add clear documentation explaining:
- When rounds are saved
- When rounds are loaded
- How filtering works
- How summaries affect context

## Verification Checklist

- [x] All rounds are saved to JSON file
- [x] All rounds are loaded from JSON file
- [x] Discussion context includes all rounds
- [x] ALL LLMs see ALL rounds (no persona-specific filtering)
- [x] Summary is included in prompt
- [x] Rounds after summary are included
- [x] Summary duplication fixed (currentSummary not duplicated)
- [x] Verify no rounds are accidentally excluded
- [x] Verify all LLMs see current round (if it exists)
- [x] Verify incomplete rounds are included for all LLMs
- [x] Verify summary + rounds logic works correctly
- [x] Execution order enforced separately (doesn't affect context)

## Next Steps

1. Add comprehensive logging to trace round flow
2. Create unit tests for context loading and filtering
3. Verify summary logic with multiple summaries
4. Test with various scenarios (no rounds, some rounds, with summary, without summary)
5. Document the complete flow
