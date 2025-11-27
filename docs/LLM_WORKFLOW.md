# LLM Workflow Documentation

**Date:** December 2024
**Version:** 1.1.0
**Last Updated:** December 2024 (Comprehensive System Review)

## Overview

This document describes the LLM workflow, including how responses are streamed to the UI, how turn order is enforced, and how chunks are accumulated to ensure complete context is displayed.

**Note:** For a comprehensive review of all LLM system components, token counting, prompt management, and data storage, see [LLM_SYSTEM_REVIEW.md](./LLM_SYSTEM_REVIEW.md).

## Turn Order System

### Turn Number Calculation

Turn numbers are calculated using the formula: `(roundNumber - 1) * 3 + position`

Where position is:
- **Analyzer AI**: 1
- **Solver AI**: 2
- **Moderator AI**: 3

**Examples:**
- Round 1: Analyzer = 1, Solver = 2, Moderator = 3
- Round 2: Analyzer = 4, Solver = 5, Moderator = 6
- Round 3: Analyzer = 7, Solver = 8, Moderator = 9

### Persona Execution Order

The system enforces a strict execution order within each round:

1. **Analyzer AI** - First to respond in each round
2. **Solver AI** - Second, responds after Analyzer
3. **Moderator AI** - Third, responds after Solver

Between rounds, the order wraps: Moderator → Analyzer (new round).

### Validation

Turn order is validated at multiple points:

1. **Pre-execution validation** (`generateAIResponse` in `handlers.ts`)
   - Calculates expected turn number
   - Validates persona order using `validatePersonaOrder()`
   - Throws error if order is incorrect

2. **Round orchestrator** (`round-orchestrator.ts`)
   - Enforces sequential execution: Analyzer → Solver → Moderator
   - Uses state machine to prevent out-of-order execution

3. **Post-execution validation** (`round-processor.ts`)
   - Validates turn numbers match expected values
   - Validates round completeness

## Streaming Workflow

### Chunk Flow

1. **LLM Provider** (`providers/*.ts`)
   - Streams chunks from API
   - Calls `onChunk` callback for each chunk
   - Handles continuation chunks if response is incomplete

2. **Socket Handler** (`handlers.ts`)
   - Accumulates chunks in `fullResponse`
   - Emits `message-chunk` events to client
   - Compares accumulated length with final response
   - Emits missing chunks if final response is longer

3. **Socket Client** (`client.ts`)
   - Receives `message-chunk` events
   - Accumulates chunks in `currentMessage.content`
   - Updates UI in real-time
   - Validates chunk accumulation on `message-complete`

4. **UI Component** (`MessageBubble.tsx`)
   - Displays `streamingContent` during streaming
   - Shows final `message.content` when complete
   - Handles incomplete message detection

### Chunk Accumulation

The system ensures complete context is displayed through:

1. **Server-side accumulation** (`handlers.ts:2310-2698`)
   - Tracks `fullResponse` (accumulated chunks)
   - Tracks `finalResponse` (from provider)
   - Emits additional chunks if `finalResponse` is longer
   - Uses `finalResponse` as source of truth

2. **Client-side accumulation** (`client.ts:524-596`)
   - Accumulates chunks in `currentMessage.content`
   - Validates against final message on `message-complete`
   - Updates content if final message is longer (missing chunks)

3. **Continuation chunk handling**
   - Detects when response needs completion
   - Requests continuation from provider
   - Emits continuation chunks to client
   - Ensures complete response is displayed

### Error Handling

If chunks are missing:

1. **Server detects mismatch** (`handlers.ts:2421-2444`)
   - Logs warning about missing chunks
   - Emits additional chunks to client
   - Updates `fullResponse` with `finalResponse`

2. **Client detects mismatch** (`client.ts:648-674`)
   - Logs error about chunk loss
   - Updates `currentMessage.content` with final content
   - Ensures UI displays complete message

## Round Processing

### Round Orchestrator

The `round-orchestrator.ts` manages the complete round lifecycle:

1. **Validation** - Validates round state
2. **Context Loading** - Loads discussion context
3. **Analyzer Processing** - Generates Analyzer response
4. **Solver Processing** - Generates Solver response (with Analyzer context)
5. **Moderator Processing** - Generates Moderator response (with both contexts)
6. **Final Validation** - Validates round completeness
7. **Round Creation** - Creates final round object

### State Machine

The `round-processor.ts` implements a state machine:

- `INITIAL` → `VALIDATING` → `PROCESSING_ANALYZER` → `PROCESSING_SOLVER` → `PROCESSING_MODERATOR` → `COMPLETE`

This ensures personas execute in the correct order and prevents race conditions.

## Validation Functions

### Location: `round-validator.ts`

All validation logic is centralized in `round-validator.ts`:

- `validatePersonaOrder()` - Validates persona execution order
- `validateTurnNumbers()` - Validates turn numbers match expected values
- `validateRoundCompleteness()` - Validates all responses exist
- `validateMessageOrdering()` - Validates message sequence

### Utility Functions

Location: `round-utils.ts`

Utility functions (non-validation):

- `calculateTurnNumber()` - Calculates turn number from round and persona
- `getPersonaFromTurnNumber()` - Gets persona from turn number
- `isRoundComplete()` - Checks if round has all responses
- `filterCompleteRounds()` - Filters complete rounds

## Testing

Integration tests are located in `tests/integration/llm/turn-order-and-chunks.test.ts`:

- Turn number calculation tests
- Persona order validation tests
- Turn number validation tests
- Round completeness validation tests
- Multi-round turn order tests
- Chunk accumulation simulation tests

## Best Practices

1. **Always use `calculateTurnNumber()`** for turn number calculation
2. **Validate persona order** before generating response
3. **Use `finalResponse` as source of truth** for message content
4. **Emit all chunks** including continuation chunks
5. **Validate chunk accumulation** on both server and client
6. **Update UI with final content** if chunks are missing

## Troubleshooting

### Missing Chunks

If chunks are missing in UI:

1. Check server logs for chunk accumulation warnings
2. Verify `finalResponse` length vs `fullResponse` length
3. Check client logs for chunk loss detection
4. Ensure continuation chunks are emitted

### Incorrect Turn Order

If turn order is incorrect:

1. Check `validatePersonaOrder()` validation
2. Verify `calculateTurnNumber()` calculation
3. Check round orchestrator state machine
4. Review logs for validation errors

### Incomplete Responses

If responses appear incomplete:

1. Check sentence validation (`sentence-validation.ts`)
2. Verify continuation chunk handling
3. Check token limits and truncation
4. Review provider completion logic
