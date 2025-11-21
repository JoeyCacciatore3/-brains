# Socket Events Documentation

## Overview

This document describes the Socket.IO event system used for real-time communication between the client and server in the @brains application.

## Event Flow Architecture

The application uses a **round-based discussion system** where:

- Each round contains responses from Solver AI, Analyzer AI, and Moderator AI
- The `rounds` array is the **primary source of truth** for discussion data
- Streaming events (`message-start`, `message-chunk`, `message-complete`) are used for real-time UI updates during message generation
- Once a round is complete, the `round-complete` event provides the complete round data with all three AI responses

## Server Events (Emitted by Server)

### `discussion-started`

**Emitted when:** A new discussion is created

**Payload:**

```typescript
{
  discussionId: string; // Discussion identifier (always present)
  hasActiveDiscussion: boolean; // Whether user already has an active discussion
}
```

**Client Action:** Resets all state, sets `discussionId`, clears rounds and messages

**Location:** `src/lib/socket/handlers.ts:193`

---

### `message-start`

**Emitted when:** An AI starts generating a response

**Payload:**

```typescript
{
  discussionId: string; // Discussion identifier
  persona: string; // 'Solver AI' | 'Analyzer AI' | 'Moderator AI'
  turn: number;
}
```

**Client Action:** Sets `currentMessage` for streaming display

**Location:** `src/lib/socket/handlers.ts:971`

---

### `message-chunk`

**Emitted when:** A chunk of AI response is generated (streaming)

**Payload:**

```typescript
{
  discussionId: string;
  chunk: string;
}
```

**Client Action:** Appends chunk to `currentMessage.content` for real-time display

**Location:** `src/lib/socket/handlers.ts:986`

---

### `message-complete`

**Emitted when:** A single AI message is complete

**Payload:**

```typescript
{
  discussionId: string;
  message: ConversationMessage;
}
```

**Client Action:** Clears `currentMessage` (streaming state). **Note:** Does NOT add to `messages` array - rounds are the source of truth.

**Location:** `src/lib/socket/handlers.ts:1021`

---

### `round-complete`

**Emitted when:** All three AIs in a round have finished responding (Solver → Analyzer → Moderator)

**Payload:**

```typescript
{
  discussionId: string;
  round: DiscussionRound; // Contains solverResponse, analyzerResponse, and moderatorResponse
}
```

**Client Action:**

- Updates `rounds` array (primary source of truth)
- Sets `currentRound`
- Clears `currentMessage`
- Sets `waitingForAction` to true

**Location:** `src/lib/socket/handlers.ts:1231`

**Note:** The `round` object includes all three AI responses (`solverResponse`, `analyzerResponse`, `moderatorResponse`) which are generated sequentially within the round.

---

### `conversation-resolved`

**Emitted when:** The discussion has been resolved (consensus reached or max rounds reached)

**Payload:**

```typescript
{
  discussionId: string; // Note: Event name kept as 'conversation-resolved' for backward compatibility
}
```

**Client Action:** Sets `isResolved` to true

**Location:** `src/lib/socket/handlers.ts:723, 745, 895`

---

### `summary-created`

**Emitted when:** A summary has been generated for rounds

**Payload:**

```typescript
{
  discussionId: string;
  summary: SummaryEntry;
}
```

**Client Action:**
- Sets `currentSummary` to the newly created summary
- Appends summary to `summaries` array (maintains history of all summaries)
- If a summary already exists for the same round number, updates it instead of duplicating

**State Management:** The client maintains both `currentSummary` (most recent) and `summaries` array (all summaries) to support:
- Display of current summary in main UI
- Summary indicators in `RoundAccordion` for historical rounds
- LocalStorage persistence for state restoration

**Location:** `src/lib/socket/handlers.ts:573, 871`

---

### `questions-generated`

**Emitted when:** Questions have been generated for a round

**Payload:**

```typescript
{
  discussionId: string;
  questionSet: QuestionSet;
  roundNumber: number;
}
```

**Client Action:** Sets `currentQuestionSet` and updates the round with questions

**Location:** `src/lib/socket/handlers.ts:671`

---

### `error`

**Emitted when:** An error occurs

**Payload:**

```typescript
{
  discussionId?: string; // Optional
  message: string;
  code?: string; // Error code from ErrorCode enum
}
```

**Client Action:** Sets error state

**Location:** Multiple locations in `src/lib/socket/handlers.ts`

---

## Client Events (Emitted by Client)

### `start-dialogue`

**Emitted when:** User starts a new dialogue

**Payload:**

```typescript
{
  topic: string;
  files?: FileData[];
  userId?: string;
}
```

**Server Action:** Creates new discussion, starts round processing

---

### `user-input`

**Emitted when:** User provides input to continue discussion

**Payload:**

```typescript
{
  discussionId: string; // Required: discussion identifier
  input: string;
}
```

**Server Action:** Appends user message, continues dialogue processing

---

### `submit-answers`

**Emitted when:** User submits answers to questions

**Payload:**

```typescript
{
  discussionId: string;
  roundNumber: number;
  answers: Record<string, string[]>; // questionId -> selected option IDs
}
```

**Server Action:** Updates round answers, continues dialogue

---

### `proceed-dialogue`

**Emitted when:** User wants to proceed to next round

**Payload:**

```typescript
{
  discussionId: string;
}
```

**Server Action:** Continues to next round

---

### `generate-summary`

**Emitted when:** User requests summary generation

**Payload:**

```typescript
{
  discussionId: string;
  roundNumber?: number; // Optional, defaults to current round
}
```

**Server Action:** Generates summary for specified rounds

---

### `generate-questions`

**Emitted when:** User requests question generation

**Payload:**

```typescript
{
  discussionId: string;
  roundNumber?: number; // Optional, defaults to current round
}
```

**Server Action:** Generates questions for specified round

---

## State Management

### Primary State (Source of Truth)

- **`rounds: DiscussionRound[]`** - Complete round data, populated from `round-complete` events
- **`currentRound: DiscussionRound | null`** - Current round being displayed

### Streaming State (Temporary)

- **`currentMessage`** - Used for real-time streaming display during message generation
  - Set by: `message-start`
  - Updated by: `message-chunk`
  - Cleared by: `message-complete`, `round-complete`

### Deprecated State (Not Used in UI)

- **`messages: ConversationMessage[]`** - Legacy array, no longer populated from `message-complete`
  - **Note:** This array is kept for backward compatibility but is not used by the UI
  - The UI exclusively uses the `rounds` array

### Action State

- **`waitingForAction: boolean`** - Set to true when `round-complete` is received
- **`needsUserInput: boolean`** - Currently unused (handler exists but server doesn't emit `needs-user-input`)

---

## Event Flow Diagram

```
User Action: Start Dialogue
    ↓
Client: emit('start-dialogue')
    ↓
Server: Creates discussion
    ↓
Server: emit('discussion-started')
    ↓
Server: Process Round
    ├─→ For Solver AI:
    │   ├─→ emit('message-start')
    │   ├─→ emit('message-chunk') [multiple]
    │   └─→ emit('message-complete')
    │
    ├─→ For Analyzer AI:
    │   ├─→ emit('message-start')
    │   ├─→ emit('message-chunk') [multiple]
    │   └─→ emit('message-complete')
    │
    └─→ For Moderator AI:
        ├─→ emit('message-start')
        ├─→ emit('message-chunk') [multiple]
        └─→ emit('message-complete')
    ↓
Server: emit('round-complete') [with complete round data - all three responses]
    ↓
Client: Updates rounds array (source of truth)
Client: Clears currentMessage
Client: Sets waitingForAction = true
```

---

## Deprecated Events

### `needs-user-input` ❌

- **Status:** Handler exists but server never emits this event
- **Replacement:** System uses `waitingForAction` state from `round-complete` event
- **Note:** Handler kept for potential future use

**Note:** The `conversation-started` event has been removed. Use `discussion-started` instead.

---

## Best Practices

1. **Always use `rounds` array as source of truth** - Don't rely on `messages` array
2. **Use `currentMessage` only for streaming display** - Clear it when round completes
3. **Validate `discussionId` in handlers** - Ignore events for different discussions
4. **Handle errors gracefully** - Check for error events and display user-friendly messages
5. **Use functional state updates** - Prevents race conditions with rapid events

---

## Testing

When testing the socket event system:

1. Verify `discussion-started` is received when starting dialogue
2. Verify streaming works (`message-start` → `message-chunk` → `message-complete`)
3. Verify `round-complete` updates `rounds` array correctly
4. Verify `currentMessage` is cleared after round completes
5. Verify error handling works correctly
6. Verify all user actions (submit answers, proceed, generate summary/questions) work

---

## Related Files

- `src/lib/socket/client.ts` - Client-side socket hook and event handlers
- `src/lib/socket/handlers.ts` - Server-side socket handlers and event emissions
- `src/types/index.ts` - Type definitions for all events
- `src/components/dialogue/DialogueHero.tsx` - Main UI component using socket state
