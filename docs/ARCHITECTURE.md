# Architecture Documentation

## AI Dialogue Platform - Complete System Architecture

**Date:** December 2024
**Version:** 1.0.0

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Directory Structure](#2-directory-structure)
3. [Core Architecture](#3-core-architecture)
4. [API & Routes](#4-api--routes)
5. [Database Architecture](#5-database-architecture)
6. [LLM Provider System](#6-llm-provider-system)
7. [Component Architecture](#7-component-architecture)
8. [Data Flow](#8-data-flow)
9. [Configuration Files](#9-configuration-files)
10. [Import/Export Map](#10-importexport-map)
11. [Type System](#11-type-system)
12. [Utilities & Helpers](#12-utilities--helpers)
13. [Monitoring & Observability](#13-monitoring--observability)
14. [Cost Tracking & Optimization](#14-cost-tracking--optimization)
15. [Resilience & Circuit Breakers](#15-resilience--circuit-breakers)
16. [Scalability & Performance](#16-scalability--performance)

---

## 1. Project Overview

### Purpose and Functionality

The AI Dialogue Platform is a real-time web application where three AI personas (Solver AI, Analyzer AI, and Moderator AI) collaborate through dialogue to solve problems and analyze topics. Users input a topic or problem, and the AIs engage in a structured conversation until they reach a resolution or need user clarification.

**Key Features:**

- Real-time bidirectional communication via Socket.IO
- Three AI personas with distinct roles and system prompts
- Multi-LLM provider support (Groq, Mistral, OpenRouter) with automatic fallback
- Intelligent resolution detection algorithm
- User input handling when AIs need clarification
- File upload support (images and PDFs)
- Message streaming for real-time display
- Discussion persistence in file system (JSON + Markdown) with SQLite metadata
- Accurate token counting using tiktoken
- Distributed file locking (Redis + in-memory) for concurrent operation safety
- Data reconciliation system for file-database synchronization

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (Browser)                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Next.js App Router (React Components)               │  │
│  │  - DialogueHero (Main UI)                            │  │
│  │  - InputSection (Topic/File Input)                  │  │
│  │  - MessageBubble (Message Display)                  │  │
│  │  - UserInput (Clarification Input)                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↕ Socket.IO                        │
└─────────────────────────────────────────────────────────────┘
                          ↕ WebSocket
┌─────────────────────────────────────────────────────────────┐
│                    Server (Node.js/Next.js)                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Socket.IO Handlers                                   │  │
│  │  - start-dialogue                                     │  │
│  │  - user-input                                         │  │
│  │  - submit-answers                                     │  │
│  │  - proceed-dialogue                                   │  │
│  │  - generate-summary                                   │  │
│  │  - generate-questions                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  LLM Provider System                                  │  │
│  │  - GroqProvider                                       │  │
│  │  - MistralProvider                                    │  │
│  │  - OpenRouterProvider                                  │  │
│  │  - Fallback Chain                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Database Layer (SQLite)                              │  │
│  │  - discussions table (metadata only)                  │  │
│  │  - File system storage (JSON + Markdown)              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

**Frontend:**

- Next.js 14.2.0 (App Router)
- React 18.2.0
- TypeScript 5.3.3
- Tailwind CSS 3.4.1
- Socket.IO Client 4.7.0
- Lucide React (Icons)

**Backend:**

- Node.js 20.18.0+
- Next.js Server
- Socket.IO Server 4.7.0
- TypeScript

**Database:**

- SQLite (better-sqlite3 9.2.0) with WAL mode
- Redis (ioredis 5.3.2) - Used for distributed rate limiting

**Logging & Monitoring:**

- Winston - Structured logging
- DOMPurify - Input sanitization

**LLM Providers:**

- Groq API
- Mistral AI API
- OpenRouter API

**Testing:**

- Vitest 1.2.0 (Unit tests)
- Playwright 1.41.0 (E2E tests)
- Testing Library (Component tests)

**Development Tools:**

- ESLint 8.57.0
  - @typescript-eslint/parser ^6.21.0
  - @typescript-eslint/eslint-plugin ^6.21.0
  - eslint-plugin-react ^7.33.2
  - eslint-plugin-react-hooks ^4.6.0
- Prettier 3.2.4
- tsx 4.7.0 (TypeScript execution)

---

## 2. Directory Structure

```
@brains/
├── data/                          # Runtime data directory
│   ├── conversations.db          # SQLite database file
│   └── discussions/              # Discussion files (JSON + Markdown)
│       └── {userId}/             # User-specific discussion files
│           └── {discussionId}.{json,md}
│
├── docs/                          # Documentation
│   ├── ARCHITECTURE.md           # This file
│   ├── README.md                 # Documentation index
│   ├── AUDIT_SUMMARY.md          # Quick audit overview
│   ├── PRIORITY_FIX_LIST.md      # Ordered fix list
│   ├── TESTING_REVIEW.md         # Testing analysis
│   ├── PRODUCTION_READINESS_CHECKLIST.md
│   ├── SECURITY_VULNERABILITY_REPORT.md
│   ├── DEPENDENCY_AUDIT.md
│   ├── EXPERT_AUDIT_REPORT.md
│   └── PERFORMANCE_ANALYSIS.md
│
├── src/                           # Source code
│   ├── app/                       # Next.js App Router
│   │   ├── api/                   # API routes
│   │   │   ├── auth/              # Authentication routes
│   │   │   │   └── [...nextauth]/ # NextAuth route handler
│   │   │   │       └── route.ts   # NextAuth route
│   │   │   ├── discussions/       # Discussions API
│   │   │   │   └── route.ts      # GET user discussions
│   │   │   └── health/            # Health check endpoint
│   │   │       └── route.ts      # Health check route handler
│   │   ├── auth/                  # Authentication pages
│   │   │   └── signin/            # Sign in page
│   │   │       └── page.tsx       # Sign in page component
│   │   ├── layout.tsx             # Root layout component (with ErrorBoundary)
│   │   ├── page.tsx               # Home page (renders DialogueHero)
│   │   └── globals.css            # Global styles and Tailwind
│   │
│   ├── components/                # React components
│   │   ├── ErrorBoundary.tsx      # React error boundary component
│   │   ├── auth/                  # Authentication components
│   │   │   ├── LoginButton.tsx    # Login button component
│   │   │   ├── UserMenu.tsx       # User menu component
│   │   │   └── SessionProvider.tsx # Session provider wrapper
│   │   ├── dialogue/              # Dialogue-specific components
│   │   │   ├── DialogueHero.tsx   # Main UI container
│   │   │   ├── InputSection.tsx   # Topic and file input
│   │   │   ├── MessageBubble.tsx  # Individual message display
│   │   │   ├── UserInput.tsx      # User clarification input
│   │   │   ├── ResolutionBanner.tsx # Resolution notification
│   │   │   └── WarningModal.tsx   # Warning modal for active discussions
│   │   ├── discussions/           # Discussion components
│   │   │   └── DiscussionHistory.tsx # Discussion history component
│   │   └── ui/                    # Reusable UI components
│   │       ├── Button.tsx         # Button component
│   │       └── LoadingSpinner.tsx # Loading indicator
│   │
│   ├── lib/                       # Core libraries and utilities
│   │   ├── auth/                  # Authentication
│   │   │   └── config.ts          # NextAuth configuration
│   │   ├── llm/                   # LLM integration
│   │   │   ├── index.ts           # Provider factory and personas
│   │   │   ├── resolver.ts        # Resolution detection logic
│   │   │   ├── summarizer.ts      # Discussion summarization
│   │   │   ├── types.ts           # LLM type definitions
│   │   │   └── providers/         # LLM provider implementations
│   │   │       ├── groq.ts       # Groq API provider
│   │   │       ├── mistral.ts    # Mistral API provider
│   │   │       └── openrouter.ts # OpenRouter API provider
│   │   │
│   │   ├── socket/                # Socket.IO integration
│   │   │   ├── client.ts          # Client-side socket hook
│   │   │   └── handlers.ts       # Server-side event handlers
│   │   │
│   │   ├── db/                    # Database layer
│   │   │   ├── index.ts           # Database connection management
│   │   │   ├── schema.ts          # Database schema and initialization
│   │   │   ├── discussions.ts     # Discussion CRUD operations (primary)
│   │   │   ├── users.ts           # User CRUD operations
│   │   │   └── redis.ts           # Redis client
│   │   │
│   │   ├── discussions/           # Discussion file management
│   │   │   ├── file-manager.ts   # File-based storage operations
│   │   │   ├── formatter.ts      # JSON/Markdown formatting
│   │   │   └── token-counter.ts  # Token counting utilities
│   │   │
│   │   ├── validation.ts          # Zod validation schemas
│   │   ├── rate-limit.ts          # Rate limiting logic (Redis + in-memory fallback)
│   │   ├── logger.ts              # Winston structured logging
│   │   ├── client-logger.ts       # Client-side logging
│   │   ├── env-validation.ts      # Environment variable validation
│   │   ├── errors.ts              # Standardized error codes and messages
│   │   ├── discussion-context.ts # LLM prompt formatting
│   │   ├── pdf-extraction.ts      # PDF text extraction
│   │   ├── type-guards.ts         # Type guard functions
│   │   ├── config.ts              # Centralized configuration
│   │   ├── personas.ts            # Persona definitions (client-safe)
│   │   └── utils.ts               # Utility functions
│   │
│   └── types/                     # TypeScript type definitions
│       └── index.ts               # Shared types and interfaces
│
├── tests/                         # Test files
│   ├── unit/                     # Unit tests
│   │   └── lib/
│   │       └── llm/
│   │           └── resolver.test.ts
│   ├── integration/               # Integration tests
│   │   └── api/
│   │       └── dialogue.test.ts   # Placeholder test
│   ├── e2e/                       # End-to-end tests
│   │   └── dialogue.spec.ts       # Playwright E2E tests
│   └── setup.ts                   # Test setup file
│
├── server.ts                      # Custom server entry point
├── next.config.js                 # Next.js configuration
├── tsconfig.json                   # TypeScript configuration
├── tailwind.config.ts              # Tailwind CSS configuration
├── vitest.config.ts                # Vitest test configuration
├── playwright.config.ts            # Playwright E2E test configuration
├── postcss.config.js               # PostCSS configuration
├── package.json                    # Dependencies and scripts
├── package-lock.json               # Locked dependencies
├── README.md                       # Project README
└── LICENSE                         # License file
```

### File Organization Patterns

- **App Router**: Next.js 14 App Router pattern with `app/` directory
- **Component Organization**: Feature-based grouping (`dialogue/`, `ui/`)
- **Library Code**: Domain-based modules (`llm/`, `socket/`, `db/`)
- **Type Definitions**: Centralized in `types/` directory
- **Tests**: Mirror source structure in `tests/` directory

---

## 3. Core Architecture

### Server Setup and Entry Points

#### `server.ts` - Custom Server Entry Point

**Purpose:** Custom HTTP server that integrates Next.js with Socket.IO

**Key Components:**

- Creates HTTP server using Node.js `http` module
- Initializes Next.js application
- Attaches Socket.IO server to HTTP server
- Sets up Socket.IO handlers

**Flow:**

```
1. Validate environment variables
2. Create Next.js app instance
3. Prepare Next.js app (build/compile)
4. Create HTTP server with Next.js request handler
5. Create Socket.IO server attached to HTTP server (with CORS validation)
6. Setup Socket.IO event handlers
7. Register graceful shutdown handlers (SIGTERM/SIGINT)
8. Start listening on configured port
```

**Configuration:**

- `NODE_ENV`: Development or production mode
- `HOSTNAME`: Server hostname (default: 'localhost')
- `PORT`: Server port (default: 3000)
- `APP_URL`: Server-side application URL for CORS (optional, falls back to NEXT_PUBLIC_APP_URL)
- `NEXT_PUBLIC_APP_URL`: CORS origin for Socket.IO
- `DATABASE_PATH`: Database file path (optional, default: 'data/conversations.db')
- `LOG_LEVEL`: Logging level (optional, default: 'info' in production, 'debug' in development)
- `REDIS_URL`: Redis connection string (optional)
- `REDIS_HOST`: Redis hostname (optional, default: 'localhost')
- `REDIS_PORT`: Redis port (optional, default: 6379)
- `REDIS_PASSWORD`: Redis password (optional)

**Code Structure:**

```typescript
// server.ts
import { createServer } from 'http';
import next from 'next';
import { Server } from 'socket.io';
import setupSocketHandlers from './src/lib/socket/handlers';
import { validateEnvironmentOrExit } from './src/lib/env-validation';
import { logger } from './src/lib/logger';
import { closeDatabase } from './src/lib/db';
import { closeRedisClient } from './src/lib/db/redis';

// Validate environment before starting
validateEnvironmentOrExit();

const app = next({ dev, hostname, port });
const httpServer = createServer(handle);
const io = new Server(httpServer, { cors: {...} }); // With origin validation
setupSocketHandlers(io);

// Graceful shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

httpServer.listen(port);
```

### Next.js App Router Structure

#### `src/app/layout.tsx` - Root Layout

**Purpose:** Root HTML structure and metadata

**Exports:**

- `metadata`: Page metadata (title, description)
- Default export: Root layout component

**Structure:**

```typescript
<html lang="en">
  <body>
    <ErrorBoundary>
      {children} // Rendered page content
    </ErrorBoundary>
  </body>
</html>
```

**Imports:**

- `./globals.css`: Global styles
- `@/components/ErrorBoundary`: Error boundary component

#### `src/app/page.tsx` - Home Page

**Purpose:** Main application page

**Exports:**

- Default export: Home page component (renders `DialogueHero`)

**Imports:**

- `@/components/dialogue/DialogueHero`

### Socket.IO Integration

#### Server-Side Setup

**Location:** `src/lib/socket/handlers.ts`

**Function:** `setupSocketHandlers(io: Server)`

**Responsibilities:**

- Register connection handler
- Register event handlers for:
  - `start-dialogue` (with rate limiting, validation, and acknowledgments)
  - `user-input` (with rate limiting, UUID validation, and acknowledgments)
  - `submit-answers` (with rate limiting, validation, and acknowledgments)
  - `proceed-dialogue` (with rate limiting, validation, and acknowledgments)
  - `generate-summary` (with rate limiting, validation, and acknowledgments)
  - `generate-questions` (with rate limiting, validation, and acknowledgments)
  - `disconnect`
- Extract client IP for rate limiting
- Manage conversation rooms
- Process dialogue loop
- Emit real-time events to clients
- Handle errors with structured logging
- Send acknowledgments for critical events

**Acknowledgments:**

- All critical events support Socket.IO acknowledgments
- Server sends acknowledgment after successful validation and before async processing
- Client implements timeout handling (5 seconds default)
- Acknowledgment failures are logged but don't block operations
- Provides delivery confirmation for important operations

**Connection Flow:**

```
1. Client connects → 'connection' event
2. Client joins conversation room (on start-dialogue)
3. Server processes events and emits responses
4. Client disconnects → 'disconnect' event
```

#### Client-Side Setup

**Location:** `src/lib/socket/client.ts`

**Hook:** `useSocket()`

**Responsibilities:**

- Initialize Socket.IO client connection
- Manage connection state
- Handle all Socket.IO events
- Provide methods to emit events
- Manage conversation state

**State Management:**

- `socket`: Socket instance
- `isConnected`: Connection status
- `discussionId`: Current discussion ID
- `currentMessage`: Currently streaming message
- `messages`: Completed messages array
- `needsUserInput`: Whether user input is needed
- `userInputQuestion`: Question text for user
- `isResolved`: Whether discussion is resolved
- `error`: Error message if any

---

## 4. API & Routes

### Socket.IO Events

#### Client → Server Events

##### `start-dialogue`

**Purpose:** Start a new dialogue conversation

**Event Name:** `'start-dialogue'`

**Payload:**

```typescript
{
  topic: string;        // 10-1000 characters
  files?: FileData[];   // Optional, max 5 files
}
```

**Validation:**

- Topic: 10-1000 characters (Zod schema)
- Files: Max 5 files, each max 10MB
- File types: images (jpeg, png, webp, gif) and PDFs

**Handler Flow:**

```
1. Validate request data (Zod schema)
2. Validate files (type, size)
3. Check for userId:
   - If userId provided: Use discussions system
     - Create discussion files (JSON + Markdown)
     - Create discussion in database
     - Join socket to discussion room
     - Emit 'discussion-started' event
4. Start dialogue processing loop
```

**Server Response Events:**

- `discussion-started`: Discussion created
- `message-start`: AI starts generating
- `message-chunk`: Streaming content chunks
- `message-complete`: Message finished
- `round-complete`: Round completed (all three AIs responded: Analyzer → Solver → Moderator)
- `questions-generated`: Questions generated for round
- `summary-created`: Summary created for rounds
- `conversation-resolved`: Resolution reached
- `error`: Error occurred

##### `user-input`

**Purpose:** Provide user input when AIs request clarification

**Event Name:** `'user-input'`

**Payload:**

```typescript
{
  discussionId: string; // UUID
  input: string; // User's response
}
```

**Validation:**

- `discussionId`: Must be valid UUID format (Zod schema)
- `discussionId`: Must exist in database
- `input`: Non-empty string

**Handler Flow:**

```
1. Extract client IP address
2. Check rate limit (Redis or in-memory)
3. Emit error if rate limit exceeded, return
4. Validate request data including UUID format
5. Validate discussion exists
6. Calculate correct turn number
7. Save user message to database (in transaction)
8. Update discussion (clear needs_user_input)
9. Continue dialogue processing
```

**Server Response Events:**

- Same as `start-dialogue` (continues dialogue)

#### Server → Client Events

##### `discussion-started`

**Purpose:** Notify client that discussion was created

**Event Name:** `'discussion-started'`

**Payload:**

```typescript
{
  discussionId: string | null; // null if hasActiveDiscussion is true
  hasActiveDiscussion: boolean;
}
```

##### `message-start`

**Purpose:** Notify client that AI is starting to generate a message

**Event Name:** `'message-start'`

**Payload:**

```typescript
{
  discussionId: string;
  persona: string; // 'Solver AI' | 'Analyzer AI' | 'Moderator AI'
  turn: number; // Exchange number
}
```

##### `message-chunk`

**Purpose:** Stream message content in real-time

**Event Name:** `'message-chunk'`

**Payload:**

```typescript
{
  discussionId: string;
  chunk: string; // Text chunk
}
```

**Frequency:** Emitted for each chunk received from LLM API

##### `message-complete`

**Purpose:** Notify client that message generation is complete

**Event Name:** `'message-complete'`

**Payload:**

```typescript
{
  discussionId: string;
  message: ConversationMessage; // Complete message object
}
```

##### `needs-user-input` ❌ DEPRECATED (REMOVED)

**Purpose:** Request user input/clarification

**Status:** This event has been **fully removed** from the codebase. The system uses `waitingForAction` state from `round-complete` event instead.

**Event Name:** `'needs-user-input'` (deprecated and removed)

**Note:** This event and its handler have been completely removed. The system uses the `round-complete` event which sets `waitingForAction` to true, allowing users to provide input via action buttons.

##### `conversation-resolved`

**Purpose:** Notify client that conversation reached resolution

**Event Name:** `'conversation-resolved'`

**Payload:**

```typescript
{
  discussionId: string;
}
```

##### `error`

**Purpose:** Notify client of errors

**Event Name:** `'error'`

**Payload:**

```typescript
{
  message: string; // Error message
}
```

### HTTP Routes

#### `/api/health` - Health Check Endpoint

**Location:** `src/app/api/health/route.ts`

**Method:** GET

**Purpose:** Check system health for deployment orchestration

**Response:**

```typescript
{
  status: 'healthy' | 'unhealthy',
  checks: {
    database: { status: 'healthy' | 'unhealthy', message?: string },
    llm: { status: 'healthy' | 'unhealthy', message?: string, providers: string[] },
    redis?: { status: 'healthy' | 'unhealthy' | 'not_configured', message?: string }
  },
  timestamp: string
}
```

**Status Codes:**

- `200 OK`: All checks pass
- `503 Service Unavailable`: Any check fails

**Checks Performed:**

- Database connectivity
- LLM provider availability (at least one required)
- Redis connectivity (optional, if configured)

#### `/api/discussions` - Get User Discussions

**Location:** `src/app/api/discussions/route.ts`

**Method:** GET

**Purpose:** Retrieve all discussions for the authenticated user

**Authentication:** Required (NextAuth session)

**Response:**

```typescript
{
  discussions: Discussion[]
}
```

**Status Codes:**

- `200 OK`: Success
- `401 Unauthorized`: Not authenticated
- `404 Not Found`: User not found
- `500 Internal Server Error`: Server error

**Process:**

1. Get session from NextAuth
2. Validate user email
3. Get user from database by email
4. Retrieve all discussions for user
5. Return discussions array

#### `/api/auth/[...nextauth]` - NextAuth Route Handler

**Location:** `src/app/api/auth/[...nextauth]/route.ts`

**Purpose:** Handle all NextAuth authentication routes

**Routes:**

- `/api/auth/signin` - Sign in page
- `/api/auth/callback/:provider` - OAuth callback
- `/api/auth/signout` - Sign out
- `/api/auth/session` - Get current session
- `/api/auth/csrf` - CSRF token

**OAuth Providers:**

- Google OAuth
- GitHub OAuth

**Configuration:**

- Environment variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `NEXTAUTH_SECRET`
- Session strategy: JWT
- Database adapter: Custom (uses SQLite users table)

**Note:** All real-time communication is via Socket.IO. HTTP routes are used for authentication and data retrieval.

---

## 5. Database Architecture

### Schema Definition

**Database:** SQLite (better-sqlite3)

**Location:** `data/conversations.db`

**Initialization:** `src/lib/db/schema.ts`

### Tables

#### `conversations` Table

**Purpose:** Store conversation metadata

**Schema:**

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,                    -- UUID
  topic TEXT NOT NULL,                    -- Conversation topic
  created_at INTEGER NOT NULL,             -- Unix timestamp
  updated_at INTEGER NOT NULL,             -- Unix timestamp
  is_resolved INTEGER NOT NULL DEFAULT 0, -- 0 or 1 (boolean)
  needs_user_input INTEGER NOT NULL DEFAULT 0, -- 0 or 1 (boolean)
  user_input_pending TEXT,                -- Question text or NULL
  current_turn INTEGER NOT NULL DEFAULT 0 -- Current turn counter
)
```

**Indexes:**

- `idx_conversations_updated_at` on `updated_at` (for recent conversations query)

**TypeScript Interface:**

```typescript
interface Conversation {
  id: string;
  topic: string;
  created_at: number;
  updated_at: number;
  is_resolved: number; // 0 or 1
  needs_user_input: number; // 0 or 1
  user_input_pending: string | null;
  current_turn: number;
}
```

#### `users` Table

**Purpose:** Store OAuth user authentication data

**Schema:**

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,                    -- UUID
  email TEXT UNIQUE NOT NULL,             -- User email
  name TEXT,                              -- User display name
  image TEXT,                             -- User profile image URL
  provider TEXT NOT NULL,                 -- OAuth provider ('google', 'github')
  provider_id TEXT NOT NULL,              -- Provider-specific user ID
  created_at INTEGER NOT NULL,            -- Unix timestamp
  updated_at INTEGER NOT NULL,            -- Unix timestamp
  UNIQUE(provider, provider_id)
)
```

**Indexes:**

- `idx_users_email` on `email` (for email lookups)
- `idx_users_provider` on `provider, provider_id` (for OAuth lookups)

**TypeScript Interface:**

```typescript
interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  provider: string;
  provider_id: string;
  created_at: number;
  updated_at: number;
}
```

#### `discussions` Table

**Purpose:** Store discussion metadata (primary system, replaces conversations for authenticated users)

**Schema:**

```sql
CREATE TABLE discussions (
  id TEXT PRIMARY KEY,                    -- UUID
  user_id TEXT NOT NULL,                  -- Foreign key to users
  topic TEXT NOT NULL,                    -- Discussion topic
  file_path_json TEXT NOT NULL,           -- Path to JSON discussion file
  file_path_md TEXT NOT NULL,             -- Path to Markdown discussion file
  token_count INTEGER NOT NULL DEFAULT 0, -- Current token count
  token_limit INTEGER NOT NULL DEFAULT 4000, -- Token limit (50% of 8K context with safety buffer)
  summary TEXT,                           -- Generated summary (if created)
  summary_created_at INTEGER,             -- Timestamp when summary was created
  created_at INTEGER NOT NULL,            -- Unix timestamp
  updated_at INTEGER NOT NULL,           -- Unix timestamp
  is_resolved INTEGER NOT NULL DEFAULT 0, -- 0 or 1 (boolean)
  needs_user_input INTEGER NOT NULL DEFAULT 0, -- 0 or 1 (boolean)
  user_input_pending TEXT,               -- Question text or NULL
  current_turn INTEGER NOT NULL DEFAULT 0, -- Current turn counter
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)
```

**Indexes:**

- `idx_discussions_user_id` on `user_id` (for user's discussions query)
- `idx_discussions_updated_at` on `updated_at` (for recent discussions query)

**TypeScript Interface:**

```typescript
interface Discussion {
  id: string;
  user_id: string;
  topic: string;
  file_path_json: string;
  file_path_md: string;
  token_count: number;
  token_limit: number;
  summary: string | null;
  summary_created_at: number | null;
  created_at: number;
  updated_at: number;
  is_resolved: number; // 0 or 1
  needs_user_input: number; // 0 or 1
  user_input_pending: string | null;
  current_turn: number;
}
```

**File-Based Storage:**

- Location: `data/discussions/{userId}/{discussionId}.json` and `.md`
- JSON format: Full discussion data with messages, metadata
- Markdown format: Human-readable discussion transcript
- Both files updated synchronously when messages are added

**Token Management:**

- Token counting: Uses actual tokenization with tiktoken for OpenAI-compatible models, falls back to estimation for unsupported models
- Token limit: Default 4000 (50% of 8K context window with safety buffer), configurable via `DISCUSSION_TOKEN_LIMIT`
- Automatic summarization: Triggered when token count reaches 80% of limit OR every 5 rounds OR 5+ rounds since last summary
- File locking: Distributed locking (Redis + in-memory) prevents concurrent write race conditions
- Data reconciliation: Periodic sync from files to database to detect and fix inconsistencies
- Temp file cleanup: Automatic cleanup of orphaned temp files (runs every 10 minutes)

**Summarization:**

- Uses Summarizer AI persona (OpenRouter provider)
- Generates summary when `token_count >= token_limit`
- Summary stored in database and included in future context
- Summary timestamp tracked for versioning

#### `messages` Table

**Purpose:** Store individual messages in conversations and discussions

**Schema:**

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,                   -- Foreign key to conversations (legacy)
  discussion_id TEXT,                     -- Foreign key to discussions (current)
  persona TEXT NOT NULL,                   -- 'Solver AI' | 'Analyzer AI' | 'Moderator AI' | 'User'
  content TEXT NOT NULL,                   -- Message content
  turn INTEGER NOT NULL,                  -- Exchange number
  timestamp TEXT NOT NULL,                -- ISO 8601 timestamp
  created_at INTEGER NOT NULL,            -- Unix timestamp
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (discussion_id) REFERENCES discussions(id) ON DELETE CASCADE,
  CHECK (conversation_id IS NOT NULL OR discussion_id IS NOT NULL)
)
```

**Indexes:**

- `idx_messages_conversation_id` on `conversation_id` (for conversation message retrieval)
- `idx_messages_discussion_id` on `discussion_id` (for discussion message retrieval)
- `idx_messages_created_at` on `created_at` (for sorting)

**TypeScript Interface:**

```typescript
interface ConversationMessage {
  id?: number;
  conversation_id?: string; // For legacy conversations
  discussion_id?: string; // For current discussions
  persona: 'Solver AI' | 'Analyzer AI' | 'Moderator AI' | 'User';
  content: string;
  turn: number;
  timestamp: string; // ISO 8601
  created_at: number; // Unix timestamp
}
```

**Note:** The CHECK constraint ensures that each message belongs to either a conversation (legacy) or a discussion (current), but not both.

### CRUD Operations

**Location:** `src/lib/db/discussions.ts`

**Note:** The deprecated `conversations.ts` file has been removed. All operations now use `discussions.ts`.

#### Create Operations

##### `createDiscussion(userId: string, topic: string, filePathJson: string, filePathMd: string, discussionId?: string): Discussion`

**Purpose:** Create a new discussion (metadata only - file content created separately)

**Process:**

1. Generate UUID
2. Get current timestamp
3. Insert into `conversations` table
4. Return conversation object

**SQL:**

```sql
INSERT INTO conversations (id, topic, created_at, updated_at, is_resolved, needs_user_input, current_turn)
VALUES (?, ?, ?, ?, 0, 0, 0)
```

##### `addMessage(message): ConversationMessage`

**Purpose:** Add a message to a conversation

**Process:**

1. Get current timestamp
2. Insert into `messages` table
3. Return message object with generated ID

**SQL:**

```sql
INSERT INTO messages (conversation_id, persona, content, turn, timestamp, created_at)
VALUES (?, ?, ?, ?, ?, ?)
```

**Note:** Uses prepared statement caching for performance.

#### Read Operations

##### `getConversation(id: string): Conversation | null`

**Purpose:** Retrieve a conversation by ID

**SQL:**

```sql
SELECT * FROM conversations WHERE id = ?
```

##### `getMessages(discussionId: string): ConversationMessage[]`

**Purpose:** Retrieve all messages for a discussion

**SQL:**

```sql
SELECT * FROM messages WHERE discussion_id = ? ORDER BY created_at ASC
```

##### `getRecentConversations(limit: number): Conversation[]`

**Purpose:** Get recent conversations

**SQL:**

```sql
SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?
```

#### Update Operations

##### `updateConversation(id: string, updates: Partial<Conversation>): void`

**Purpose:** Update conversation fields

**Updatable Fields:**

- `is_resolved`
- `needs_user_input`
- `user_input_pending`
- `current_turn`
- `updated_at` (always updated)

**SQL:**

```sql
UPDATE conversations SET updated_at = ?, [field] = ? WHERE id = ?
```

**Transaction Support:**

- Wrapped in database transaction for atomicity
- Ensures data consistency
- Rollback on errors

### Discussions CRUD Operations

**Location:** `src/lib/db/discussions.ts`

#### Create Operations

##### `createDiscussion(userId, topic, filePathJson, filePathMd): Discussion`

**Purpose:** Create a new discussion

**Process:**

1. Generate UUID
2. Get current timestamp
3. Get token limit from environment or default (4000)
4. Insert into `discussions` table
5. Return discussion object

**SQL:**

```sql
INSERT INTO discussions (id, user_id, topic, file_path_json, file_path_md, token_count, token_limit, created_at, updated_at, is_resolved, needs_user_input, current_turn)
VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, 0)
```

#### Read Operations

##### `getDiscussion(id: string): Discussion | null`

**Purpose:** Retrieve a discussion by ID

**SQL:**

```sql
SELECT * FROM discussions WHERE id = ?
```

##### `getUserDiscussions(userId: string): Discussion[]`

**Purpose:** Retrieve all discussions for a user

**SQL:**

```sql
SELECT * FROM discussions WHERE user_id = ? ORDER BY updated_at DESC
```

##### `getActiveDiscussion(userId: string): Discussion | null`

**Purpose:** Get user's active (unresolved) discussion

**SQL:**

```sql
SELECT * FROM discussions WHERE user_id = ? AND is_resolved = 0 ORDER BY updated_at DESC LIMIT 1
```

#### Update Operations

##### `updateDiscussion(id: string, updates: Partial<Discussion>): void`

**Purpose:** Update discussion fields

**Updatable Fields:**

- `token_count`
- `token_limit`
- `summary`
- `summary_created_at`
- `is_resolved`
- `needs_user_input`
- `user_input_pending`
- `current_turn`
- `updated_at` (always updated)

**SQL:**

```sql
UPDATE discussions SET updated_at = ?, [field] = ? WHERE id = ?
```

**Transaction Support:**

- Wrapped in database transaction for atomicity
- Ensures data consistency
- Rollback on errors

### File-Based Storage Operations

**Location:** `src/lib/discussions/file-manager.ts`

#### `createDiscussionFiles(userId, topic, discussionId?): Promise<{id, jsonPath, mdPath}>`

**Purpose:** Create discussion files (JSON + Markdown)

**Process:**

1. Generate discussion ID if not provided
2. Ensure user directory exists: `data/discussions/{userId}/`
3. Create JSON file with initial discussion data
4. Create Markdown file with formatted transcript
5. Return file paths

#### `readDiscussion(userId, discussionId): Promise<DiscussionData>`

**Purpose:** Read discussion data from JSON file

**Returns:** Discussion data with messages array

#### `appendMessage(userId, discussionId, message): Promise<void>`

**Purpose:** Append message to discussion files

**Process:**

1. Read current discussion data
2. Append message to messages array
3. Update token count
4. Write updated data to JSON file
5. Append formatted message to Markdown file

#### `updateDiscussionWithSummary(userId, discussionId, summary): Promise<void>`

**Purpose:** Update discussion files with generated summary

**Process:**

1. Read current discussion data
2. Update summary field
3. Write updated data to JSON file
4. Update Markdown file with summary section

### Backup Operations

**Location:** `src/lib/discussions/backup-manager.ts`

#### `backupDiscussion(userId, discussionId): Promise<string>`

**Purpose:** Create a backup of a discussion

**Process:**

1. Verify discussion exists and user ownership
2. Read discussion data
3. Create backup directory: `data/backups/{userId}/{discussionId}-{timestamp}/`
4. Copy JSON and Markdown files to backup location
5. Create metadata.json with backup information
6. Return backup directory path

**Configuration:**

- `BACKUP_ENABLED`: Enable/disable backups (default: true)
- `BACKUP_RETENTION_DAYS`: Days to retain backups (default: 30)
- `BACKUP_INTERVAL_HOURS`: Hours between periodic backups (default: 1)

#### `cleanupOldBackups(): Promise<void>`

**Purpose:** Remove backups older than retention policy

**Process:**

1. Calculate cutoff date (now - retention days)
2. Scan all user backup directories
3. Delete backups older than cutoff date
4. Log cleanup results

#### `schedulePeriodicBackups(): Promise<void>`

**Purpose:** Start periodic backup scheduler

**Process:**

1. Run initial cleanup
2. Schedule periodic backups for active discussions
3. Run cleanup after each backup cycle

**Note:** Backups are created asynchronously and do not block main operations.

### Token Counting Operations

**Location:** `src/lib/discussions/token-counter.ts`

**Status:** ✅ **Updated** (December 2024) - Token estimation standardized to 3.5 chars/token with centralized constant and helper function.

**Constants:**
- `TOKEN_ESTIMATION_CHARS_PER_TOKEN = 3.5` - Standardized token estimation constant

**Functions:**
- `estimateTokensFromChars(charCount: number): number` - Centralized token estimation helper
- `estimateTokenCount(text: string): number` - Enhanced estimation algorithm (uses standardized constant)

**Purpose:** Estimate token count from text

**Algorithm:** Standardized to 3.5 characters per token (English text approximation). Uses `TOKEN_ESTIMATION_CHARS_PER_TOKEN` constant for consistency across codebase.

#### `getTokenLimit(): number`

**Purpose:** Get token limit from environment or default

**Default:** 4000 tokens (50% of 8K context window with safety buffer)

**Environment Variable:** `DISCUSSION_TOKEN_LIMIT`

#### `hasReachedThreshold(currentCount, limit?): boolean`

**Purpose:** Check if token count has reached 60% threshold

**Returns:** `true` if `currentCount >= limit`

### Summarization Operations

**Location:** `src/lib/llm/summarizer.ts`

#### `shouldSummarize(tokenCount, tokenLimit): boolean`

**Purpose:** Check if discussion should be summarized

**Threshold:** 60% of token limit

#### `generateSummary(discussionId, userId, topic, messages): Promise<string>`

**Purpose:** Generate summary using Summarizer AI persona

**Process:**

1. Get Summarizer AI persona (OpenRouter provider)
2. Format conversation transcript
3. Build summarization prompt
4. Stream response from LLM
5. Return generated summary

#### `summarizeDiscussion(discussionId, userId): Promise<{summary, summaryCreatedAt}>`

**Purpose:** Complete summarization workflow

**Process:**

1. Read discussion data
2. Generate summary
3. Update discussion files with summary
4. Update database with summary and timestamp
5. Return summary and creation timestamp

### Connection Management

**Location:** `src/lib/db/index.ts`

**Function:** `getDatabase(): Database.Database`

**Implementation:**

- Singleton pattern
- Creates database instance on first call
- Reuses same instance for subsequent calls

**Connection Details:**

- Database path: Configurable via `DATABASE_PATH` env var (default: `data/conversations.db`)
- Foreign keys: Enabled
- WAL mode: Enabled for concurrent reads
- Connection health checks: Available via `checkDatabaseHealth()`
- Connection retry logic: 3 attempts with exponential backoff

**Cleanup:**

- `closeDatabase(): void` - Closes database connection

**Note:** Currently single connection. For production, should enable WAL mode for concurrent reads.

### Redis (Used for Rate Limiting)

**Location:** `src/lib/db/redis.ts`

**Status:** Implemented and actively used

**Purpose:** Distributed rate limiting for multi-instance deployments

**Functions:**

- `getRedisClient(): Redis | null` - Get Redis client instance
- `closeRedisClient(): void` - Close Redis connection

**Configuration:**

- `REDIS_URL`: Connection string (preferred)
- `REDIS_HOST`: Hostname (default: 'localhost', used if REDIS_URL not set)
- `REDIS_PORT`: Port (default: 6379)
- `REDIS_PASSWORD`: Optional password

**Usage:**

- Rate limiting uses Redis when available
- Falls back to in-memory store if Redis unavailable
- Enables distributed rate limiting across multiple server instances

---

## 6. Authentication System

### Overview

**Location:** `src/lib/auth/config.ts`, `src/app/api/auth/[...nextauth]/route.ts`

**Purpose:** User authentication and session management using NextAuth v5

**Authentication Method:** OAuth (Google, GitHub)

**Session Strategy:** JWT (JSON Web Tokens)

### NextAuth Configuration

**Location:** `src/lib/auth/config.ts`

**Configuration:**

```typescript
export const authOptions: NextAuthConfig = {
  providers: [
    GoogleProvider({ ... }),
    GitHubProvider({ ... }),
  ],
  callbacks: {
    signIn: async ({ user, account }) => { ... },
    session: async ({ session }) => { ... },
  },
  pages: {
    signIn: '/auth/signin',
  },
  secret: (() => {
    const secret = process.env.NEXTAUTH_SECRET;
    const isProduction = process.env.NODE_ENV === 'production';
    const defaultSecret = 'development-secret-change-in-production';

    if (isProduction) {
      if (!secret || secret === defaultSecret) {
        throw new Error(
          'NEXTAUTH_SECRET is required in production and must not be the default value. ' +
          'Please set a strong, random secret in your environment variables. ' +
          'You can generate one with: openssl rand -base64 32'
        );
      }
    }

    return secret || defaultSecret;
  })(),
};
```

**Security Features:**
- Production validation: Fails fast if `NEXTAUTH_SECRET` is missing or using default value
- Development fallback: Allows default secret only in development mode
- Clear error messages: Provides instructions for generating secure secrets

### Socket.IO Authentication

**Location:** `src/lib/socket/auth-middleware.ts`

**Purpose:** Authenticate Socket.IO connections using NextAuth session tokens

**Implementation:**

1. **Session Token Extraction:**
   - Parses cookies from Socket.IO handshake headers
   - Extracts NextAuth session token from cookies
   - Supports multiple cookie name formats (production/development)

2. **JWT Verification:**
   - Uses `jose` library to decode and verify JWT tokens
   - Verifies token signature using `NEXTAUTH_SECRET`
   - Extracts user information from JWT payload

3. **User Lookup:**
   - Verifies user exists in database
   - Retrieves full user information
   - Creates `SocketUser` object with authentication status

4. **Connection Handling:**
   - **Production:** Requires authentication, rejects anonymous connections
   - **Development:** Allows anonymous connections for testing
   - Attaches user information to `socket.data.user`

**Functions:**

- `getSessionFromSocket(socket: Socket)`: Extracts and verifies session from socket
- `authenticateSocket(socket: Socket)`: Main authentication function
- `getSocketUser(socket: Socket)`: Get user from socket data
- `isSocketAuthenticated(socket: Socket)`: Check if user is authenticated
- `getSocketUserId(socket: Socket)`: Get user ID (authenticated or anonymous)

**Security:**
- JWT tokens verified with secret key
- User existence verified in database
- Anonymous connections blocked in production
- Clear logging for authentication events

### OAuth Providers

#### Google OAuth

**Provider:** `GoogleProvider` from `next-auth/providers/google`

**Configuration:**

- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret

**Flow:**

1. User clicks "Sign in with Google"
2. Redirected to Google OAuth consent screen
3. User authorizes application
4. Google redirects to `/api/auth/callback/google`
5. NextAuth processes callback and creates/updates user

#### GitHub OAuth

**Provider:** `GitHubProvider` from `next-auth/providers/github`

**Configuration:**

- `GITHUB_CLIENT_ID`: GitHub OAuth client ID
- `GITHUB_CLIENT_SECRET`: GitHub OAuth client secret

**Flow:**

1. User clicks "Sign in with GitHub"
2. Redirected to GitHub OAuth authorization screen
3. User authorizes application
4. GitHub redirects to `/api/auth/callback/github`
5. NextAuth processes callback and creates/updates user

### User Management

**Location:** `src/lib/db/users.ts`

#### `getUserByEmail(email: string): User | null`

**Purpose:** Retrieve user by email address

**SQL:**

```sql
SELECT * FROM users WHERE email = ?
```

#### `getUserById(id: string): User | null`

**Purpose:** Retrieve user by ID

**SQL:**

```sql
SELECT * FROM users WHERE id = ?
```

#### `createUser(userData): User`

**Purpose:** Create new user (called automatically by NextAuth)

**Process:**

1. Generate UUID for user ID
2. Insert into `users` table
3. Return user object

#### `updateUser(id, updates): void`

**Purpose:** Update user information

**Updatable Fields:**

- `name`
- `image`
- `updated_at` (always updated)

### Authentication Flow

**Sign In Flow:**

```
1. User clicks "Sign in" button
2. Redirected to /auth/signin page
3. User selects OAuth provider (Google/GitHub)
4. Redirected to provider's OAuth consent screen
5. User authorizes application
6. Provider redirects to /api/auth/callback/{provider}
7. NextAuth signIn callback:
   - Checks if user exists by email
   - If exists: Updates user info (name, image)
   - If not: Creates new user in database
8. Session created with JWT token
9. User redirected to home page
```

**Session Management:**

```
1. Session stored as JWT token
2. Session callback adds user.id to session object
3. Session accessible via auth() function in server components
4. Session accessible via useSession() hook in client components
5. Session expires based on NextAuth configuration
```

**Sign Out Flow:**

```
1. User clicks "Sign out"
2. signOut() function called
3. Session invalidated
4. User redirected to home page
```

### API Routes

#### `/api/auth/[...nextauth]`

**Location:** `src/app/api/auth/[...nextauth]/route.ts`

**Purpose:** Catch-all route for NextAuth endpoints

**Routes:**

- `GET /api/auth/signin` - Sign in page
- `POST /api/auth/signin/{provider}` - Initiate OAuth flow
- `GET /api/auth/callback/{provider}` - OAuth callback handler
- `POST /api/auth/signout` - Sign out endpoint
- `GET /api/auth/session` - Get current session
- `GET /api/auth/csrf` - Get CSRF token

**Exports:**

- `GET`: NextAuth GET handler
- `POST`: NextAuth POST handler

### Client Components

**Location:** `src/components/auth/`

#### `LoginButton.tsx`

**Purpose:** Sign in button component

**Features:**

- Displays when user is not authenticated
- Shows sign in options (Google, GitHub)
- Handles OAuth redirect

#### `UserMenu.tsx`

**Purpose:** User menu component

**Features:**

- Displays when user is authenticated
- Shows user name and image
- Sign out button
- User profile information

#### `SessionProvider.tsx`

**Purpose:** Session provider wrapper for client components

**Usage:**

- Wraps application to provide session context
- Enables `useSession()` hook in child components

### Server-Side Authentication

**Usage in Server Components:**

```typescript
import { auth } from '@/lib/auth/config';

export default async function ServerComponent() {
  const session = await auth();
  if (!session) {
    // User not authenticated
  }
  // User authenticated, access session.user
}
```

**Usage in API Routes:**

```typescript
import { auth } from '@/lib/auth/config';

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Process authenticated request
}
```

### Client-Side Authentication

**Usage in Client Components:**

```typescript
'use client';
import { useSession } from 'next-auth/react';

export default function ClientComponent() {
  const { data: session, status } = useSession();
  if (status === 'loading') {
    return <Loading />;
  }
  if (!session) {
    return <LoginButton />;
  }
  return <UserMenu user={session.user} />;
}
```

### Environment Variables

**Required:**

- `NEXTAUTH_SECRET`: Secret key for JWT signing (generate with `openssl rand -base64 32`)

**OAuth Provider Variables:**

- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret
- `GITHUB_CLIENT_ID`: GitHub OAuth client ID
- `GITHUB_CLIENT_SECRET`: GitHub OAuth client secret

**Optional:**

- `NEXTAUTH_URL`: Base URL for OAuth callbacks (defaults to `NEXT_PUBLIC_APP_URL`)

### Security Considerations

- JWT tokens signed with `NEXTAUTH_SECRET`
- OAuth state parameter prevents CSRF attacks
- User data stored securely in database
- Session tokens expire automatically
- HTTPS required in production for OAuth

---

## 7. LLM Provider System

### Provider Interface

**Location:** `src/lib/llm/types.ts`

**Interface:** `LLMProvider`

```typescript
interface LLMProvider {
  name: string;
  stream: (messages: LLMMessage[], onChunk: (chunk: string) => void) => Promise<string>;
}
```

**Message Format:**

```typescript
interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  files?: FileData[]; // For file support (images, PDFs)
}
```

**Configuration:**

```typescript
interface LLMConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}
```

### Provider Implementations

#### GroqProvider

**Location:** `src/lib/llm/providers/groq.ts`

**API Endpoint:** `https://api.groq.com/openai/v1/chat/completions`

**Default Model:** `llama-3.1-8b-instant`

**Default Config:**

- `maxTokens`: 1000
- `temperature`: 0.7

**Streaming:**

- Uses Server-Sent Events (SSE)
- Parses `data: ` prefixed lines
- Extracts content from `choices[0].delta.content`

**Timeout:**

- 60-second timeout using AbortController
- Graceful error handling on timeout
- User-friendly error messages

**Environment Variable:** `GROQ_API_KEY`

#### MistralProvider

**Location:** `src/lib/llm/providers/mistral.ts`

**API Endpoint:** `https://api.mistral.ai/v1/chat/completions`

**Default Model:** `mistral-large-latest`

**Default Config:**

- `maxTokens`: 1000
- `temperature`: 0.7

**Streaming:**

- Uses Server-Sent Events (SSE)
- Parses `data: ` prefixed lines
- Extracts content from `choices[0].delta.content`

**Timeout:**

- 60-second timeout using AbortController
- Graceful error handling on timeout
- User-friendly error messages

**Environment Variable:** `MISTRAL_API_KEY`

#### OpenRouterProvider

**Location:** `src/lib/llm/providers/openrouter.ts`

**API Endpoint:** `https://openrouter.ai/api/v1/chat/completions`

**Default Model:** `openai/gpt-4o-mini`

**Default Config:**

- `maxTokens`: 1000
- `temperature`: 0.7

**Streaming:**

- Uses Server-Sent Events (SSE)
- Parses `data: ` prefixed lines
- Extracts content from `choices[0].delta.content`
- OpenAI-compatible format

**Special Features:**

- **PDF Text Extraction:** Automatically extracts text from PDF files and appends to content
- Supports multiple models via OpenRouter (GPT-4, Llama, etc.)
- Uses `pdf-parse` library for PDF extraction
- File metadata included for images and other file types
- HTTP-Referer header for API usage tracking

**PDF Processing:**

- PDFs are processed server-side using `extractTextFromPDF()`
- Extracted text is appended to message content
- If extraction fails, file metadata is included instead
- Only PDFs are processed; images and other files include metadata only

**Timeout:**

- 60-second timeout using AbortController
- Graceful error handling on timeout
- User-friendly error messages

**Environment Variable:** `OPENROUTER_API_KEY`

### Provider Factory

**Location:** `src/lib/llm/index.ts`

#### `getLLMProvider(providerName, config?): LLMProvider`

**Purpose:** Get a specific LLM provider instance

**Providers:**

- `'groq'` → GroqProvider
- `'mistral'` → MistralProvider
- `'openrouter'` → OpenRouterProvider

**Error Handling:**

- Throws error if API key not set
- Throws error for unknown provider

#### `getProviderWithFallback(primaryProvider, config?): LLMProvider`

**Purpose:** Get provider with automatic fallback chain

**Fallback Chain:**

1. Primary provider (specified)
2. OpenRouter (most reliable, supports multiple models)
3. Groq
4. Mistral

**Process:**

1. Try primary provider
2. If fails, try next in chain
3. Continue until one succeeds
4. Throw error if all fail

**Use Case:** Ensures dialogue continues even if one provider fails

### AI Personas

**Location:** `src/lib/llm/index.ts`

**Definition:** `aiPersonas` object

#### Solver AI

**Provider:** Groq (default)

**System Prompt:** Focuses on:

- Breaking down problems systematically
- Proposing concrete solutions
- Asking clarifying questions
- Practical implementation
- Building on partner's ideas

**Color:** Blue (`bg-blue-500`, `text-blue-400`)

#### Analyzer AI

**Provider:** Mistral (default)

**System Prompt:** Focuses on:

- Examining assumptions
- Exploring edge cases
- Asking probing questions
- Multiple perspectives
- Challenging constructively

**Color:** Purple (`bg-purple-500`, `text-purple-400`)

#### Summarizer AI

**Provider:** OpenRouter (default)

**System Prompt:** Focuses on:

- Analyzing full context of discussions
- Identifying key points, decisions, and conclusions
- Creating concise, comprehensive summaries
- Maintaining flow and context
- Highlighting unresolved questions

**Color:** Green (`bg-green-500`, `text-green-400`)

**Usage:**

- Used for automatic discussion summarization
- Triggered when token count reaches 60% threshold
- Generates summaries to maintain context awareness
- Summaries stored in discussion files and database

#### Moderator AI

**Provider:** OpenRouter (default)

**System Prompt:** Focuses on:

- Participating directly in discussions as a third AI perspective
- Guiding the conversation toward productive outcomes
- Clarifying points of confusion or ambiguity
- Synthesizing ideas from Solver AI, Analyzer AI, and Moderator AI responses
- Keeping discussion focused and on-topic
- Identifying areas of agreement and disagreement
- Providing a balanced perspective to enrich the dialogue

**Color:** Yellow (`bg-yellow-500`, `text-yellow-400`)

**Usage:**

- Generates moderator summary after each round completes
- Runs asynchronously (doesn't block round completion)
- Summary includes: round summary, accuracy check, on-topic check, insights, and optional suggested questions
- All three AI responses displayed in UI: Solver, Analyzer, and Moderator
- Can inform question generation when available
- Stored in discussion files and included in round data

**Moderator Summary Structure:**

```typescript
interface ModeratorSummary {
  summary: string; // Concise summary of round exchange
  accuracyCheck: string; // Verification of claims
  onTopicCheck: string; // Assessment of topic relevance
  suggestedQuestions?: string[]; // Optional question suggestions
  insights: string; // Key insights and depth
  generatedAt: string; // ISO timestamp
}
```

### Token Counting and Summarization

**Location:** `src/lib/discussions/token-counter.ts`, `src/lib/llm/summarizer.ts`

**Purpose:** Manage discussion context length and automatically summarize long discussions

**Token Counting:**

- Estimation: ~4 characters per token (English text)
- Token count tracked per discussion
- Default limit: 4000 tokens (50% of 8K context window with safety buffer)
- Configurable via `DISCUSSION_TOKEN_LIMIT` environment variable

**Summarization Trigger:**

- Automatic when `token_count >= token_limit`
- Uses Summarizer AI persona (OpenRouter provider)
- Generates comprehensive summary of discussion
- Summary includes: main topic, key insights, decisions, open questions

**Summarization Process:**

1. Check if token count reached threshold
2. Read full discussion from files
3. Generate summary using Summarizer AI
4. Update discussion files with summary
5. Update database with summary and timestamp
6. Summary included in future context instead of full transcript

**Benefits:**

- Maintains context awareness for long discussions
- Reduces token usage for subsequent messages
- Preserves essential information
- Enables longer discussions without context loss

### Resolution Detection

**Location:** `src/lib/llm/resolver.ts`

#### `isResolved(conversation: Message[]): boolean`

**Purpose:** Detect if conversation reached resolution

**Algorithm:**

1. Requires at least 4 messages (2 exchanges)
2. Checks for resolution keywords:
   - 'solution', 'conclusion', 'recommendation', 'agreement', 'consensus', 'resolved', 'final', 'summary', 'therefore', 'in conclusion', 'to summarize', 'we can conclude', 'the answer is', 'the solution is'
3. Checks for agreement patterns:
   - 'i agree', 'that makes sense', 'you're right', 'exactly', 'precisely', 'that's correct'
4. Checks for convergence:
   - Last 4 messages average length < 300 characters
   - Different personas in last 2 messages
5. Safety limit: 20 turns (40 messages) = auto-resolve

**Returns:** `true` if resolved, `false` otherwise

#### `needsUserInput(conversation: Message[]): { needsInput: boolean; question?: string }`

**Purpose:** Detect if AIs need user clarification

**Algorithm:**

1. Checks last message (skips if from User)
2. Looks for question patterns:
   - Contains `?`
   - 'can you clarify/explain/provide/tell/help'
   - 'could you clarify/explain/provide/tell/help'
   - 'would you like/prefer/want'
   - 'what do you/would you/is your'
   - 'how do you/would you/should we'
   - 'which do you/would you/should we'
   - 'to better understand'
   - 'i need more/additional/further information/details/context/clarification'
   - 'could you help me understand'
   - 'i'd like to know'
   - 'please clarify/explain/provide/tell'
3. Looks for request patterns:
   - 'i/we need your/more input/feedback/clarification/information'
   - 'please/can you/could you provide/give/share more/additional/further'
   - 'what are your thoughts/opinions/preferences/requirements'
   - 'what is/are your'
4. Extracts question text if found

**Returns:** Object with `needsInput` boolean and optional `question` string

---

## 7. Component Architecture

### Component Hierarchy

```
DialogueHero (Main Container)
├── InputSection
│   ├── Button (Upload)
│   └── Button (Start)
├── UserInput (Conditional)
│   └── Button (Send)
├── ResolutionBanner (Conditional)
└── Round Display
    └── RoundDisplay (for each round)
        ├── Analyzer AI MessageBubble
        ├── Solver AI MessageBubble
        └── Moderator Summary Box (smaller, below exchange)
            └── (loading state or summary content)
```

### Component Details

#### DialogueHero

**Location:** `src/components/dialogue/DialogueHero.tsx`

**Type:** Client Component (`'use client'`)

**Purpose:** Main UI container and state orchestrator

**State Management:**

- Uses `useSocket()` hook for all socket state

**Props:** None (self-contained)

**Key Responsibilities:**

- Render header with title and description
- Display connection status
- Render input section
- Show user input prompt when needed
- Display resolution banner
- Render conversation messages and rounds
- Auto-scroll to bottom on new messages

**Imports:**

- `@/components/dialogue/InputSection`
- `@/components/dialogue/MessageBubble`
- `@/components/dialogue/ResolutionBanner`
- `@/components/dialogue/UserInput`
- `@/components/dialogue/RoundDisplay`
- `@/components/dialogue/RoundAccordion`
- `@/lib/socket/client`
- `@/lib/validation`
- `@/types`

#### InputSection

**Location:** `src/components/dialogue/InputSection.tsx`

**Type:** Client Component

**Purpose:** Topic input and file upload

**Props:**

```typescript
{
  onStart: (topic: string, files: FileData[]) => void;
  isProcessing: boolean;
  error?: string;
}
```

**State:**

- `topic`: string
- `files`: File[]

**Key Features:**

- Textarea for topic input
- File upload (images and PDFs)
- File validation (type, size)
- Base64 encoding of files
- Base64 size validation (15MB limit after encoding)
- File name sanitization using `sanitizeFilename()`
- Max 5 files
- Max 10MB per file

**Imports:**

- `@/components/ui/Button`
- `@/components/ui/LoadingSpinner`
- `@/lib/utils` (includes sanitizeFilename)
- `@/lib/validation`

#### MessageBubble

**Location:** `src/components/dialogue/MessageBubble.tsx`

**Type:** Server Component (no 'use client')

**Purpose:** Display individual message

**Props:**

```typescript
{
  message: Message | ConversationMessage;
  streamingContent?: string;
  streamingMode?: StreamingMode;
  isStreaming?: boolean;
}
```

**Features:**

- Persona badge with color
- Turn/exchange number
- Message content with whitespace preservation
- Streaming indicator
- Streaming mode support (word-by-word vs message-by-message)
- **XSS Protection:** Content sanitization using DOMPurify

**XSS Protection Implementation:**

- Uses `isomorphic-dompurify` for cross-platform sanitization
- Sanitizes all user-generated content before rendering
- Preserves whitespace and formatting while removing XSS vectors
- Works in both server and client contexts
- Provides defense-in-depth beyond React's default escaping
- Handles both streaming and static content

**Imports:**

- `@/types`
- `@/lib/utils`
- `isomorphic-dompurify` (for sanitization)

#### RoundDisplay

**Location:** `src/components/dialogue/RoundDisplay.tsx`

**Type:** Client Component (`'use client'`)

**Purpose:** Display a complete round with solver, analyzer, and moderator summary

**Props:**

```typescript
{
  round: DiscussionRound;
  isCurrentRound?: boolean;
}
```

**Features:**

- Displays round number and timestamp
- Grid layout: 3 columns for Solver AI, Analyzer AI, and Moderator AI responses (responsive)
- Full-width moderator summary box below exchange
- Shows loading state while moderator summary is being generated
- Displays moderator summary sections: summary, accuracy check, on-topic check, insights, and suggested questions
- Uses moderator persona colors (yellow theme)
- Handles backward compatibility (rounds without moderator summaries)

**Layout:**

- Top: Round header with number and timestamp
- Middle: 3-column grid with Solver AI, Analyzer AI, and Moderator AI message bubbles
- Bottom: Full-width moderator summary box (smaller, compact design)

**Imports:**

- `@/types` (DiscussionRound, ModeratorSummary)
- `@/components/dialogue/MessageBubble`
- `lucide-react` (Loader2 for loading indicator)

#### UserInput

**Location:** `src/components/dialogue/UserInput.tsx`

**Type:** Client Component

**Purpose:** User clarification input

**Props:**

```typescript
{
  question?: string | null;
  onSubmit: (input: string) => void;
  disabled?: boolean;
}
```

**State:**

- `input`: string

**Features:**

- Displays question from AI
- Textarea for user response
- Submit button
- Keyboard shortcut: Cmd/Ctrl+Enter to submit

**Imports:**

- `@/components/ui/Button`

#### ResolutionBanner

**Location:** `src/components/dialogue/ResolutionBanner.tsx`

**Type:** Server Component

**Purpose:** Display resolution notification

**Props:**

```typescript
{
  onDismiss?: () => void;
}
```

**Features:**

- Green success styling
- Resolution message
- Optional dismiss button

#### Button

**Location:** `src/components/ui/Button.tsx`

**Type:** Server Component

**Purpose:** Reusable button component

**Props:**

```typescript
extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
}
```

**Variants:**

- `primary`: Blue background
- `secondary`: Transparent with border
- `danger`: Red background

**Imports:**

- `@/lib/utils` (for `cn` className utility)

#### LoadingSpinner

**Location:** `src/components/ui/LoadingSpinner.tsx`

**Type:** Server Component

**Purpose:** Loading indicator

**Props:**

```typescript
{
  className?: string;
}
```

**Implementation:** Uses Lucide `Loader2` icon with spin animation

#### ErrorBoundary

**Location:** `src/components/ErrorBoundary.tsx`

**Type:** Client Component

**Purpose:** React error boundary for graceful error handling

**Props:**

```typescript
{
  children: ReactNode;
  fallback?: ReactNode;
}
```

**Features:**

- Catches React component errors
- Provides fallback UI with error message
- Error recovery mechanism (Try again button)
- Development error details (stack traces)
- Error reporting integration ready

**State:**

- `hasError`: boolean
- `error`: Error | null
- `errorInfo`: ErrorInfo | null

**Methods:**

- `componentDidCatch()`: Catches errors and updates state
- `handleReset()`: Resets error state

**Usage:**

- Wraps application in `layout.tsx`
- Catches errors in component tree
- Displays user-friendly error message

### Client-Side Hooks

#### useSocket

**Location:** `src/lib/socket/client.ts`

**Type:** React Hook

**Purpose:** Manage Socket.IO connection and state

**Returns:**

```typescript
{
  socket: Socket | null;
  isConnected: boolean;
  discussionId: string | null;
  currentMessage: { persona: string; turn: number; content: string } | null;
  messages: ConversationMessage[];
  needsUserInput: boolean;
  userInputQuestion: string | null;
  isResolved: boolean;
  error: string | null;
  startDialogue: (topic: string, files?: FileData[]) => void;
  sendUserInput: (input: string) => void;
  continueDialogue: () => void;
  reset: () => void;
}
```

**Lifecycle:**

1. Initialize socket on mount
2. Register event listeners
3. Cleanup on unmount

**Event Handlers:**

- `connect` → Set `isConnected = true`
- `disconnect` → Set `isConnected = false`
- `connect_error` → Set error
- `discussion-started` → Set discussionId, reset state
- `message-start` → Set currentMessage
- `message-chunk` → Append to currentMessage.content
- `message-complete` → Add to messages, clear currentMessage
- `conversation-resolved` → Set isResolved
- `error` → Set error message

---

## 8. Data Flow

### Conversation Lifecycle

```
1. User Input
   └─> InputSection collects topic and files
       └─> Files converted to base64
           └─> startDialogue() called

2. Socket Emission
   └─> Client emits 'start-dialogue' event
       └─> Server receives event

3. Server Processing
   └─> Validate request (Zod schema)
       └─> Create conversation in database
           └─> Join socket to discussion room
               └─> Emit 'discussion-started'
                   └─> Start dialogue loop

4. Round Processing Loop
   └─> For each round:
       ├─> Generate Analyzer AI response
       │   ├─> Emit 'message-start'
       │   ├─> Stream response (emit 'message-chunk')
       │   └─> Emit 'message-complete'
       ├─> Generate Solver AI response
       │   ├─> Emit 'message-start'
       │   ├─> Stream response (emit 'message-chunk')
       │   └─> Emit 'message-complete'
       ├─> Create round object
       ├─> Save round to files
       ├─> Emit 'round-complete' (round displayed immediately)
       ├─> Generate moderator summary (async, non-blocking)
       │   └─> Emit 'moderator-summary-created' when ready
       ├─> Check for resolution
       │   └─> If resolved: emit 'conversation-resolved', break
       └─> Continue to next round

5. Client Updates
   └─> Socket events update React state
       ├─> 'discussion-started' → Reset state, set discussionId
       ├─> 'message-start' → Initialize currentMessage
       ├─> 'message-chunk' → Append to currentMessage.content
       ├─> 'message-complete' → Clear currentMessage (rounds are source of truth)
       ├─> 'round-complete' → Add round to rounds array, display round, set waitingForAction
       ├─> 'moderator-summary-created' → Update round with moderator summary
       ├─> 'questions-generated' → Set currentQuestionSet
       ├─> 'summary-created' → Set currentSummary
       └─> 'conversation-resolved' → Show ResolutionBanner
```

### Message Streaming Flow

```
LLM API Response (SSE Stream)
    │
    ├─> Server reads chunks
    │   └─> Parses JSON from 'data: ' lines
    │       └─> Extracts content delta
    │           └─> Calls onChunk callback
    │               └─> Emits 'message-chunk' to room
    │                   └─> Client receives chunk
    │                       └─> Updates currentMessage.content
    │                           └─> React re-renders MessageBubble
    │                               └─> User sees streaming text
    │
    └─> Stream completes
        └─> Server accumulates full response
            └─> Saves to database
                └─> Emits 'message-complete'
                    └─> Client adds to messages array
                        └─> Clears currentMessage
```

### User Input Flow

```
1. Round completes
   └─> Server emits 'round-complete' event
       └─> Client sets waitingForAction = true
           └─> Action buttons become available (User Input, Proceed, etc.)

2. User provides input
   └─> UserInput component collects text
       └─> sendUserInput() called
           └─> Client emits 'user-input' event
               └─> Server receives event

3. Server processes input
   └─> Validate conversation exists
       └─> Calculate turn number
           └─> Save user message to database
               └─> Update conversation (needs_user_input = 0)
                   └─> Continue dialogue loop
```

### File Upload Flow

```
1. User selects files
   └─> InputSection validates files
       ├─> Check file type (images/PDFs)
       ├─> Check file size (max 10MB)
       └─> Add to files state

2. User starts dialogue
   └─> Files processed to base64
       └─> FileData objects created
           └─> Sent via Socket.IO event

3. Server receives files
   └─> Files included in first LLM message
       └─> Groq/Mistral/OpenRouter: File metadata in text prompt

4. LLM processes files
   └─> All providers receive file descriptions in text format
```

### Error Flow

```
Error occurs at any stage
    │
    ├─> Server catches error
    │   └─> Logs error (console.error)
    │       └─> Emits 'error' event to room
    │           └─> Client receives error
    │               └─> Sets error state
    │                   └─> InputSection displays error
    │
    └─> Client-side errors
        └─> React error boundary (not implemented)
            └─> Socket connection errors
                └─> Handled by useSocket hook
                    └─> Sets error state
```

---

## 9. Configuration Files

### TypeScript Configuration

**File:** `tsconfig.json`

**Key Settings:**

- `target`: ES2020
- `module`: esnext
- `moduleResolution`: bundler
- `strict`: true
- `jsx`: preserve (React)
- `paths`: `@/*` → `./src/*`

**Strict Checks:**

- `noUnusedLocals`: true
- `noUnusedParameters`: true
- `noImplicitReturns`: true
- `noFallthroughCasesInSwitch`: true

### Next.js Configuration

**File:** `next.config.js`

**Settings:**

- `reactStrictMode`: true
- `images.remotePatterns`: [] (no remote images)
- `headers()`: CORS headers for `/api/*` routes

**CORS Configuration:**

- `Access-Control-Allow-Credentials`: true
- `Access-Control-Allow-Origin`: `APP_URL` or `NEXT_PUBLIC_APP_URL` or localhost
- `Access-Control-Allow-Methods`: GET, OPTIONS, PATCH, DELETE, POST, PUT
- `Access-Control-Allow-Headers`: Various headers

**Security Headers:**

- `X-Frame-Options`: DENY
- `X-Content-Type-Options`: nosniff
- `Referrer-Policy`: strict-origin-when-cross-origin
- `Content-Security-Policy`: Configured with appropriate directives
- `Strict-Transport-Security`: Enabled in production only (HSTS)

### Tailwind CSS Configuration

**File:** `tailwind.config.ts`

**Content Paths:**

- `./src/pages/**/*.{js,ts,jsx,tsx,mdx}`
- `./src/components/**/*.{js,ts,jsx,tsx,mdx}`
- `./src/app/**/*.{js,ts,jsx,tsx,mdx}`

**Theme:**

- Custom colors: `background`, `foreground` (CSS variables)

### Vitest Configuration

**File:** `vitest.config.ts`

**Settings:**

- Environment: `jsdom`
- Globals: true
- Setup file: `./tests/setup.ts`
- Coverage provider: `v8`
- Coverage reporters: text, json, html

**Exclusions:**

- `node_modules/`
- `tests/`
- `**/*.config.*`
- `**/types/**`
- `src/app/**`

**Path Alias:**

- `@` → `./src`

### Playwright Configuration

**File:** `playwright.config.ts`

**Settings:**

- Test directory: `./tests/e2e`
- Base URL: `http://localhost:3000`
- Reporter: HTML
- Retries: 2 in CI, 0 locally

**Web Server:**

- Command: `npm run dev`
- URL: `http://localhost:3000`
- Reuse existing server if available

### PostCSS Configuration

**File:** `postcss.config.js`

**Plugins:**

- Tailwind CSS
- Autoprefixer

### Environment Variables

**Required:**

- `GROQ_API_KEY`: Groq API key
- `MISTRAL_API_KEY`: Mistral API key
- `OPENROUTER_API_KEY`: OpenRouter API key
- `NEXT_PUBLIC_APP_URL`: Application URL for CORS

**Optional:**

- `NODE_ENV`: Development or production
- `HOSTNAME`: Server hostname (default: 'localhost')
- `PORT`: Server port (default: 3000)
- `RATE_LIMIT_MAX_REQUESTS`: Max requests per window (default: 10)
- `RATE_LIMIT_WINDOW_MS`: Rate limit window in ms (default: 60000)
- `REDIS_URL`: Redis connection string
- `REDIS_HOST`: Redis hostname
- `REDIS_PORT`: Redis port
- `NEXT_PUBLIC_SOCKET_URL`: Socket.IO server URL (defaults to window.location.origin)

---

## 10. Import/Export Map

### Core Module Dependencies

#### `server.ts`

**Exports:** None (entry point)
**Imports:**

- `http.createServer`
- `url.parse`
- `next` (default)
- `socket.io.Server`
- `@/lib/socket/handlers.setupSocketHandlers`

#### `src/app/layout.tsx`

**Exports:** `metadata`, default component
**Imports:**

- `next.Metadata`
- `./globals.css`

#### `src/app/page.tsx`

**Exports:** default component
**Imports:**

- `@/components/dialogue/DialogueHero`

#### `src/lib/socket/handlers.ts`

**Exports:** `setupSocketHandlers`, `setupSocketIO` (default)
**Imports:**

- `socket.io.Server`, `Socket`
- `@/lib/db/conversations.*` (all CRUD functions)
- `@/lib/discussion-context.formatLLMPrompt`
- `@/lib/llm.getProviderWithFallback`, `aiPersonas`
- `@/lib/llm/resolver.isResolved`, `needsUserInput`
- `@/lib/validation.*` (dialogueRequestSchema, userInputSchema, continueDialogueSchema)
- `@/lib/rate-limit.checkRateLimit`
- `@/lib/logger.logger`
- `@/types.*` (all event types)
- `@/lib/llm/types.LLMMessage`
- `@/lib/validation.FileData`

**Key Functions:**

- `extractClientIP(socket: Socket): string` - Extract IP from socket for rate limiting
- `setupSocketHandlers(io: Server)` - Setup all socket event handlers
- `processDialogue()` - Main dialogue processing loop

#### `src/lib/socket/client.ts`

**Exports:** `useSocket`
**Imports:**

- `react.useEffect`, `useState`
- `socket.io-client.io`, `Socket`
- `@/types.*` (all event types)
- `@/lib/validation.FileData`

#### `src/lib/llm/index.ts`

**Exports:** `getLLMProvider`, `getProviderWithFallback`, `aiPersonas`, `Persona`
**Imports:**

- `./providers/groq.GroqProvider`
- `./providers/mistral.MistralProvider`
- `./providers/openrouter.OpenRouterProvider`
- `./types.LLMProvider`, `LLMConfig`

#### `src/lib/llm/resolver.ts`

**Exports:** `isResolved`, `needsUserInput`
**Imports:**

- `@/types.Message`, `ConversationMessage`

#### `src/lib/db/index.ts`

**Exports:** `getDatabase`, `closeDatabase`
**Imports:**

- `better-sqlite3.Database`
- `./schema.createDatabase`

#### `src/lib/db/schema.ts`

**Exports:** `createDatabase`
**Imports:**

- `better-sqlite3.Database`
- `path.join`
- `fs.existsSync`, `mkdirSync`

#### `src/lib/db/conversations.ts` ⚠️ DEPRECATED (FILE REMOVED)

**Status:** This file has been removed. All functionality has been migrated to `discussions.ts`.
**Note:** This section is kept for historical reference only. All new code must use `discussions.ts`.

#### `src/lib/db/redis.ts`

**Exports:** `getRedisClient`, `closeRedisClient`
**Imports:**

- `ioredis.Redis`

#### `src/lib/rate-limit.ts`

**Exports:** `checkRateLimit`, `getRemainingRequests`
**Imports:**

- `./db/redis.getRedisClient`
- `./logger.logger`

**Key Functions:**

- `checkRateLimit(ip: string): Promise<boolean>` - Check rate limit (async, Redis or in-memory)
- `checkRateLimitRedis(ip: string): Promise<boolean>` - Redis-based rate limiting
- `checkRateLimitMemory(ip: string): boolean` - In-memory rate limiting (fallback)
- `cleanupExpiredEntries(): void` - Periodic cleanup of expired entries

#### `src/lib/validation.ts`

**Exports:** `fileDataSchema`, `dialogueRequestSchema`, `discussionIdSchema`, `userInputSchema`, `continueDialogueSchema`, `DialogueRequest`, `FileData`, `UserInputRequest`, `ContinueDialogueRequest`
**Imports:**

- `zod.z`

**Schemas:**

- `discussionIdSchema` - UUID format validation (replaces deprecated conversationIdSchema)
- `userInputSchema` - User input event validation
- `continueDialogueSchema` - Continue dialogue event validation

#### `src/lib/discussion-context.ts`

**Exports:** `loadDiscussionContext`, `formatLLMPrompt`
**Imports:**

- `./discussions/file-manager.readDiscussion`
- `@/types.ConversationMessage`, `DiscussionRound`, `SummaryEntry`
- `@/lib/validation.FileData`

#### `src/lib/utils.ts`

**Exports:** `cn`, `fileToBase64`, `getFileMediaType`, `sanitizeFilename`
**Imports:**

- `clsx.clsx`, `ClassValue`
- `tailwind-merge.twMerge`

#### `src/types/index.ts`

**Exports:** All type definitions
**Imports:** None (pure types)

### Component Dependencies

#### `DialogueHero.tsx`

**Exports:** `DialogueHero`
**Imports:**

- `react.useState`, `useRef`, `useEffect`
- `lucide-react.Brain`, `MessageSquare`
- `./InputSection`
- `./MessageBubble`
- `./ResolutionBanner`
- `./UserInput`
- `./StreamingToggle`
- `@/lib/socket/client.useSocket`
- `@/lib/validation.FileData`
- `@/types.StreamingMode`

#### `InputSection.tsx`

**Exports:** `InputSection`
**Imports:**

- `react.useState`, `useRef`
- `lucide-react.Upload`, `X`, `AlertCircle`
- `@/components/ui/Button`
- `@/components/ui/LoadingSpinner`
- `@/lib/utils.fileToBase64`, `getFileMediaType`
- `@/lib/validation.FileData`

#### `MessageBubble.tsx`

**Exports:** `MessageBubble`
**Imports:**

- `@/types.Message`, `ConversationMessage`, `StreamingMode`
- `@/lib/utils.cn`

#### `UserInput.tsx`

**Exports:** `UserInput`
**Imports:**

- `react.useState`
- `lucide-react.Send`, `MessageSquare`
- `@/components/ui/Button`

#### `ResolutionBanner.tsx`

**Exports:** `ResolutionBanner`
**Imports:**

- `lucide-react.CheckCircle2`

#### `Button.tsx`

**Exports:** `Button`
**Imports:**

- `react.ButtonHTMLAttributes`, `ReactNode`
- `@/lib/utils.cn`

#### `LoadingSpinner.tsx`

**Exports:** `LoadingSpinner`
**Imports:**

- `lucide-react.Loader2`

### Circular Dependency Analysis

**No circular dependencies detected.** Dependency graph is acyclic:

```
server.ts
  └─> handlers.ts
      ├─> db/discussions.ts
      ├─> llm/index.ts
      │   └─> providers/*
      └─> validation.ts

components/*
  └─> lib/socket/client.ts
      └─> types/index.ts
```

All imports flow in one direction: components → lib → types.

---

## 11. Type System

### Core Types

#### Conversation Types

**Location:** `src/types/index.ts`

```typescript
interface Conversation {
  id: string; // UUID
  topic: string;
  created_at: number; // Unix timestamp
  updated_at: number; // Unix timestamp
  is_resolved: number; // 0 or 1 (SQLite boolean)
  needs_user_input: number; // 0 or 1 (SQLite boolean)
  user_input_pending: string | null;
  current_turn: number;
}

interface ConversationMessage {
  id?: number; // Auto-increment
  conversation_id: string; // UUID
  persona: 'Solver AI' | 'Analyzer AI' | 'Moderator AI' | 'User';
  content: string;
  turn: number; // Exchange number
  timestamp: string; // ISO 8601
  created_at: number; // Unix timestamp
}
```

#### Socket.IO Event Types

```typescript
// Client → Server
interface StartDialogueEvent {
  topic: string;
  files?: FileData[];
  userId?: string; // Optional for backward compatibility
}

interface UserInputEvent {
  discussionId: string; // Standardized: always discussionId
  input: string;
}

interface ContinueDialogueEvent {
  discussionId: string; // Standardized: always discussionId
}

// Server → Client
interface DiscussionStartedEvent {
  discussionId: string | null; // null if hasActiveDiscussion is true
  hasActiveDiscussion: boolean;
}

interface MessageStartEvent {
  discussionId: string; // Standardized: always discussionId
  persona: string;
  turn: number;
}

interface MessageChunkEvent {
  discussionId: string; // Standardized: always discussionId
  chunk: string;
}

interface MessageCompleteEvent {
  discussionId: string; // Standardized: always discussionId
  message: ConversationMessage;
}

interface NeedsUserInputEvent {
  discussionId: string; // Standardized: always discussionId (deprecated event)
  question?: string;
}

interface ConversationResolvedEvent {
  discussionId: string; // Standardized: always discussionId (event name kept for backward compatibility)
}

interface SocketErrorEvent {
  message: string;
}

interface ModeratorSummaryCreatedEvent {
  discussionId: string;
  roundNumber: number;
  moderatorSummary: ModeratorSummary;
}
```

#### Round-Based Discussion Types

**Location:** `src/types/index.ts`

```typescript
interface DiscussionRound {
  roundNumber: number;
  solverResponse: ConversationMessage;
  analyzerResponse: ConversationMessage;
  moderatorSummary?: ModeratorSummary; // Optional, generated asynchronously
  timestamp: string;
  questions?: QuestionSet;
  userAnswers?: string[];
}

interface ModeratorSummary {
  summary: string; // Concise summary of the round exchange
  accuracyCheck: string; // Verification of claims and accuracy
  onTopicCheck: string; // Assessment of whether discussion is on topic
  suggestedQuestions?: string[]; // Optional suggestions for questions
  insights: string; // Key insights and depth added to context
  generatedAt: string; // ISO timestamp
}

interface QuestionSet {
  roundNumber: number;
  questions: Question[];
  generatedAt: string;
}

interface Question {
  id: string;
  text: string;
  options: QuestionOption[];
  userAnswers?: string[];
}

interface QuestionOption {
  id: string;
  text: string;
}
```

#### LLM Types

**Location:** `src/lib/llm/types.ts`

```typescript
interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  files?: FileData[];
}

interface LLMProvider {
  name: string;
  stream: (messages: LLMMessage[], onChunk: (chunk: string) => void) => Promise<string>;
}

interface LLMConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}
```

#### Validation Types

**Location:** `src/lib/validation.ts`

```typescript
// Zod schemas
const fileDataSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string(),
  size: z.number().max(10 * 1024 * 1024), // 10MB
  base64: z.string().optional(),
});

const dialogueRequestSchema = z.object({
  topic: z.string().min(10).max(1000),
  files: z.array(fileDataSchema).max(5).optional(),
});

// Inferred types
type DialogueRequest = z.infer<typeof dialogueRequestSchema>;
type FileData = z.infer<typeof fileDataSchema>;
```

#### Component Props Types

```typescript
// DialogueHero: No props (self-contained)

// InputSection
interface InputSectionProps {
  onStart: (topic: string, files: FileData[]) => void;
  isProcessing: boolean;
  error?: string;
}

// MessageBubble
interface MessageBubbleProps {
  message: Message | ConversationMessage;
  streamingContent?: string;
  streamingMode?: StreamingMode;
  isStreaming?: boolean;
}

// UserInput
interface UserInputProps {
  question?: string | null;
  onSubmit: (input: string) => void;
  disabled?: boolean;
}

// ResolutionBanner
interface ResolutionBannerProps {
  onDismiss?: () => void;
}

// RoundDisplay
interface RoundDisplayProps {
  round: DiscussionRound;
  isCurrentRound?: boolean;
}

// StreamingToggle
interface StreamingToggleProps {
  mode: StreamingMode;
  onChange: (mode: StreamingMode) => void;
  disabled?: boolean;
}

// Button
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
}
```

#### Utility Types

```typescript
type StreamingMode = 'word-by-word' | 'message-by-message';

type ClassValue = string | number | boolean | undefined | null | ClassValue[];
```

### Type Safety Features

1. **Strict TypeScript:** All files use strict mode
2. **No `any` types:** Explicit typing throughout
3. **Runtime Validation:** Zod schemas for user input
4. **Database Types:** Interfaces match SQLite schema
5. **Event Types:** All Socket.IO events typed
6. **Component Props:** All props interfaces defined
7. **Type Guards:** Runtime type checking functions (see Type Guards section)

### Type Guards

**Location:** `src/lib/type-guards.ts`

**Purpose:** Runtime type validation functions that replace unsafe type assertions

**Functions:**

#### `isPersona(value: string): value is 'Solver AI' | 'Analyzer AI' | 'Moderator AI' | 'User'`

**Purpose:** Validate persona string

**Returns:** Type predicate indicating if value is a valid persona

#### `isValidConversationMessagePersona(persona: string): persona is ConversationMessage['persona']`

**Purpose:** Type guard for ConversationMessage persona field

**Returns:** Type predicate for persona type

#### `isUUID(value: string): boolean`

**Purpose:** Validate UUID format (RFC 4122)

**Returns:** `true` if value matches UUID format

#### `isNonEmptyString(value: unknown): value is string`

**Purpose:** Check if value is a non-empty string

**Returns:** Type predicate indicating if value is a non-empty string

#### `isPositiveInteger(value: unknown): value is number`

**Purpose:** Check if value is a positive integer

**Returns:** Type predicate indicating if value is a positive integer

**Usage:**

```typescript
import { isPersona, isUUID } from '@/lib/type-guards';

if (isPersona(value)) {
  // TypeScript knows value is 'Solver AI' | 'Analyzer AI' | 'Moderator AI' | 'User'
}

if (isUUID(id)) {
  // TypeScript knows id is a valid UUID format
}
```

---

## 12. Utilities & Helpers

### Utility Functions

#### `src/lib/utils.ts`

##### `cn(...inputs: ClassValue[]): string`

**Purpose:** Merge Tailwind CSS classes

**Implementation:**

- Uses `clsx` for conditional classes
- Uses `tailwind-merge` to resolve conflicts
- Returns merged className string

**Usage:**

```typescript
cn('base-class', condition && 'conditional-class', className);
```

##### `fileToBase64(file: File): Promise<string>`

**Purpose:** Convert File to base64 string

**Implementation:**

- Uses FileReader API
- Returns Promise with base64 data (without data URI prefix)

**Usage:**

```typescript
const base64 = await fileToBase64(file);
```

##### `getFileMediaType(file: File): string`

**Purpose:** Get MIME type for file

**Implementation:**

- Returns file.type for images
- Returns 'application/pdf' for PDFs
- Returns 'application/octet-stream' for others

**Usage:**

```typescript
const mediaType = getFileMediaType(file);
```

##### `sanitizeFilename(filename: string): string`

**Purpose:** Sanitize filename for safe use

**Implementation:**

- Replaces non-alphanumeric characters (except `.` and `-`) with `_`

**Usage:**

```typescript
const safe = sanitizeFilename('file name (1).pdf'); // 'file_name__1_.pdf'
```

**Note:** Now used in InputSection.tsx for file name sanitization.

### Configuration Module

**Location:** `src/lib/config.ts`

**Purpose:** Centralized configuration constants and environment variable defaults

**Configuration Objects:**

#### `RATE_LIMIT_CONFIG`

- `MAX_REQUESTS`: Maximum requests per window (default: 10)
- `WINDOW_MS`: Rate limit window in milliseconds (default: 60000)

#### `DIALOGUE_CONFIG`

- `MAX_TURNS`: Maximum conversation turns (default: 20, from `MAX_TURNS` env var)
- `MIN_MESSAGE_LENGTH`: Minimum message length (10 characters)
- `MAX_MESSAGE_LENGTH`: Maximum message length (1000 characters)
- `RESOLUTION_CONVERGENCE_THRESHOLD`: Character threshold for resolution detection (300)
- `MIN_MESSAGES_FOR_RESOLUTION`: Minimum messages required for resolution (4)
- `AUTO_RESOLVE_TURN_LIMIT`: Auto-resolve after this many turns (20)

#### `FILE_CONFIG`

- `MAX_FILE_SIZE`: Maximum file size in bytes (10MB)
- `MAX_BASE64_SIZE`: Maximum base64 size in bytes (15MB)
- `MAX_FILES`: Maximum number of files per request (5)
- `ALLOWED_IMAGE_TYPES`: Array of allowed image MIME types
- `ALLOWED_PDF_TYPE`: Allowed PDF MIME type

#### `LLM_CONFIG`

- `DEFAULT_TIMEOUT_MS`: Default LLM request timeout (60000ms)
- `DEFAULT_MAX_TOKENS`: Default maximum tokens (1000)
- `DEFAULT_TEMPERATURE`: Default temperature (0.7)

#### `DATABASE_CONFIG`

- `PATH`: Database file path (default: 'data/conversations.db')
- `STATEMENT_CACHE_SIZE`: Prepared statement cache size (100)

#### `LOGGING_CONFIG`

- `LEVEL`: Logging level (default: 'info' in production, 'debug' in development)

#### `SERVER_CONFIG`

- `HOSTNAME`: Server hostname (default: 'localhost')
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Node environment (default: 'development')

**Usage:**

```typescript
import { RATE_LIMIT_CONFIG, DIALOGUE_CONFIG } from '@/lib/config';

const maxRequests = RATE_LIMIT_CONFIG.MAX_REQUESTS;
const maxTurns = DIALOGUE_CONFIG.MAX_TURNS;
```

### Client-Side Logging

**Location:** `src/lib/client-logger.ts`

**Purpose:** Structured logging for client-side code that matches server-side logger interface

**Features:**

- Log levels: `debug`, `info`, `warn`, `error`
- Structured logging with timestamps and context
- Level filtering based on environment
- Falls back to console methods in browser

**Usage:**

```typescript
import { clientLogger } from '@/lib/client-logger';

clientLogger.info('User action', { userId, action: 'start-dialogue' });
clientLogger.error('Error occurred', { error: error.message });
```

**Configuration:**

- `NEXT_PUBLIC_LOG_LEVEL`: Client-side log level (default: 'info' in production, 'debug' in development)

### Prepared Statement Caching

**Location:** `src/lib/db/discussions.ts`

**Purpose:** Performance optimization by caching prepared SQL statements

**Implementation:**

- LRU (Least Recently Used) cache pattern
- Cache size limit: 100 statements (configurable via `DATABASE_CONFIG.STATEMENT_CACHE_SIZE`)
- Prevents memory growth from repeated statement preparation
- Improves query performance for frequently used queries

**Cache Functions:**

#### `getCachedStatement(sql: string): Database.Statement`

**Purpose:** Get or create cached prepared statement

**Process:**

1. Check if statement exists in cache
2. If exists, return cached statement
3. If not, prepare new statement and add to cache
4. If cache is full, remove least recently used statement
5. Return statement

**Benefits:**

- Faster query execution (no re-preparation)
- Reduced memory allocation
- Better performance for repeated queries

### Database Recovery Mechanisms

**Location:** `src/lib/db/index.ts`, `src/lib/db/schema.ts`

**Purpose:** Handle database connection issues and recovery

**Features:**

#### WAL Mode Lock Handling

- Automatic WAL file lock detection
- Retry logic with exponential backoff
- Graceful handling of concurrent access

#### Connection Health Checks

- `checkDatabaseHealth()`: Verify database connectivity
- Returns health status and error messages
- Used by health check endpoint

#### Connection Retry Logic

- 3 retry attempts with exponential backoff
- Handles transient connection failures
- Logs retry attempts for debugging

#### Graceful Shutdown

- Database connection cleanup on server shutdown
- Proper transaction rollback on errors
- WAL file cleanup

**Recovery Process:**

1. Detect connection failure or lock
2. Wait with exponential backoff (1s, 2s, 4s)
3. Retry connection
4. If all retries fail, log error and throw exception
5. Health check endpoint reports status

### Validation Logic

#### `src/lib/validation.ts`

**Zod Schemas:**

##### `fileDataSchema`

- Validates file metadata
- `name`: 1-255 characters
- `type`: string
- `size`: max 10MB
- `base64`: optional string

##### `dialogueRequestSchema`

- Validates dialogue start request
- `topic`: 10-1000 characters
- `files`: optional array, max 5 files

##### `discussionIdSchema`

- Validates UUID format for discussion IDs (replaces deprecated conversationIdSchema)
- Uses RFC 4122 UUID regex pattern

##### `userInputSchema`

- Validates user input events
- `discussionId`: Must be valid UUID
- `input`: Non-empty string

##### `continueDialogueSchema`

- Validates continue dialogue events
- `discussionId`: Must be valid UUID

**Usage:**

```typescript
const result = dialogueRequestSchema.safeParse(data);
if (!result.success) {
  // Handle validation errors
}
```

### Rate Limiting

#### `src/lib/rate-limit.ts`

**Implementation:** Redis-based distributed rate limiting with in-memory fallback

**Functions:**

##### `checkRateLimit(ip: string): Promise<boolean>`

**Purpose:** Check if IP has exceeded rate limit (async)

**Logic:**

1. Try Redis-based rate limiting first (if Redis available)
2. Use Redis INCR with TTL for distributed limiting
3. Fall back to in-memory Map if Redis unavailable
4. Return true if rate limit exceeded, false otherwise

**Redis Implementation:**

- Uses key pattern: `rate_limit:{ip}`
- Uses INCR to increment counter
- Sets TTL equal to WINDOW_MS on first request
- Checks if count exceeds MAX_REQUESTS

**In-Memory Implementation:**

- Uses Map-based storage
- Periodic cleanup every 60 seconds
- Cleans expired entries automatically

**Configuration:**

- `MAX_REQUESTS`: 10 (default, from env)
- `WINDOW_MS`: 60000 (1 minute, from env)

**Cleanup:**

- Periodic cleanup runs every 60 seconds
- Cleans expired entries from in-memory store
- Redis entries expire automatically via TTL

##### `getRemainingRequests(ip: string): number`

**Purpose:** Get remaining requests for IP

**Returns:** Number of requests remaining in current window

**Note:** Rate limiting is **actively used** in all socket handlers (start-dialogue, user-input, submit-answers, proceed-dialogue, generate-summary, generate-questions).

### File Processing

#### File Upload Flow

1. **Client-side (`InputSection.tsx`):**
   - User selects files
   - Files validated (type, size)
   - Files converted to base64 via `fileToBase64()`
   - FileData objects created
   - Sent via Socket.IO

2. **Server-side (`handlers.ts`):**
   - Files validated again (Zod schema)
   - Files included in first LLM message
   - All providers: File metadata in text prompt

#### Base64 Encoding

**Process:**

1. FileReader reads file as Data URL
2. Extract base64 portion (after comma)
3. Return base64 string

**Size Increase:** ~33% (base64 encoding overhead)

**Validation:**

- Base64 size validated after encoding
- Maximum base64 size: 15MB (for 10MB file)
- Rejects oversized payloads before sending

### Conversation Context Formatting

#### `src/lib/discussion-context.ts`

##### `formatLLMPrompt(topic, messages, isFirstMessage, respondingPersonaName, files?, ...): string`

**Purpose:** Format conversation context for LLM

**Status:** ✅ **Refactored** (December 2024) - Function has been broken down into smaller helper functions for better maintainability.

**Helper Functions:**
- `formatSummaryContext()` - Formats summary sections
- `formatFileInfo()` - Formats file information
- `formatUserAnswersSection()` - Formats user answers
- `formatRoundTranscript()` - Formats round transcripts
- `formatFirstMessagePrompt()` - Formats first message prompts
- `formatUserInputPrompt()` - Formats user input prompts
- `formatNewRoundPrompt()` - Formats new round prompts
- `formatContinuationPrompt()` - Formats continuation prompts

**Parameters:**

- `topic`: The conversation topic
- `messages`: Array of conversation messages (includes User messages)
- `isFirstMessage`: Whether this is the first message in the conversation
- `respondingPersonaName`: The name of the AI persona that will be responding ('Solver AI', 'Analyzer AI', or 'Moderator AI')
- `files?`: Optional file attachments (only used for first message)
- `rounds?`: Optional rounds array (new round-based structure)
- `currentSummary?`: Optional current summary entry
- `summaries?`: Optional all summaries
- `userAnswers?`: Optional user answers to questions
- `currentRoundNumber?`: Optional current round number

**First Message:**

- Includes topic
- Includes file information (if provided)
- Instructions for initial analysis

**Subsequent Messages:**

- Includes full conversation transcript (including User messages if present)
- If last message is from User: Includes user's input and instructions to respond to it
- If last message is from AI: Includes last message from other AI and instructions to respond
- Properly handles alternating between AI personas and user input

**Format:**

```
Topic: "{topic}"

Full conversation so far:

[Exchange 1] Solver AI: ...
[Exchange 1] Analyzer AI: ...
[Exchange 2] Solver AI: ...

---

You are now in Exchange N. [Other AI] just said:

"{lastMessage}"

[Response instructions]
```

##### `loadDiscussionContext(discussionId: string, userId: string): Promise<{ topic, messages, rounds, summary, currentSummary, summaries, tokenCount }>`

**Purpose:** Load and format discussion from file storage

**Returns:**

- `topic`: Discussion topic
- `messages`: Array of ConversationMessage (legacy, generated from rounds)
- `rounds`: Array of DiscussionRound (primary source of truth)
- `summary`: Legacy summary string (deprecated, use currentSummary)
- `currentSummary`: Most recent SummaryEntry with metadata
- `summaries`: All SummaryEntry objects
- `tokenCount`: Calculated token count for context

**Note:** This function loads discussion data from file storage (JSON + Markdown), not database. Rounds are the primary source of truth.

### Logging System

#### `src/lib/logger.ts`

**Implementation:** Winston structured logging with automatic sanitization

**Features:**

- Structured JSON logging in production
- Colorized console logging in development
- File rotation for production logs
- Configurable log levels
- Error stack trace capture
- Automatic sanitization of sensitive data

**Log Sanitization:**

- Removes API keys, secrets, tokens, and passwords
- Redacts email addresses
- Removes JWT tokens
- Sanitizes file contents (only logs metadata)
- Applies to all log entries automatically via Winston format
- Uses pattern matching and key-based filtering

**Sanitization Function:** `sanitizeLogData(data: unknown): unknown`

- Recursively sanitizes objects and arrays
- Handles strings with regex pattern matching
- Preserves log structure while removing sensitive data

**Log Levels:**

- `error`: Error events
- `warn`: Warning events
- `info`: Informational messages
- `debug`: Debug messages (development only)

**Transports:**

- Console transport (always enabled)
- File transport (production only)
  - `logs/error.log` - Error level logs
  - `logs/combined.log` - All logs

**Configuration:**

- `LOG_LEVEL`: Log level (default: 'info' in production, 'debug' in development)

**Usage:**

```typescript
import { logger } from '@/lib/logger';

logger.info('Server started', { port, hostname });
logger.error('Error occurred', { error, context });
```

### Environment Validation

#### `src/lib/env-validation.ts`

**Purpose:** Validate required environment variables on startup

**Functions:**

##### `validateEnvironment(): ValidationResult`

**Purpose:** Check environment variables

**Validates:**

- At least one LLM API key must be present
- Rate limit configuration values
- Redis configuration (if provided)
- Optional but recommended variables

##### `validateEnvironmentOrExit(): void`

**Purpose:** Validate and exit if critical variables missing

**Behavior:**

- Validates environment on server startup
- Exits with code 1 if critical variables missing
- Provides clear error messages
- Logs warnings for optional variables

### Error Handling

#### `src/lib/errors.ts`

**Purpose:** Standardized error codes and messages

**Features:**

- Error code enumeration
- Standardized error message format
- Error message templates
- Helper functions for error creation

**Error Codes:**

- Rate limiting errors (1000-1099)
- Validation errors (1100-1199)
- Database errors (1200-1299)
- LLM provider errors (1300-1399)
- Network errors (1400-1499)
- General errors (1500-1599)

**Usage:**

```typescript
import { createErrorFromCode, ErrorCode } from '@/lib/errors';

const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED);
```

### Error Boundaries

#### `src/components/ErrorBoundary.tsx`

**Purpose:** React error boundary for graceful error handling

**Features:**

- Catches React component errors
- Provides fallback UI
- Error recovery mechanism
- Development error details
- Error reporting integration ready

**Usage:**

- Wraps application in `layout.tsx`
- Catches errors in component tree
- Displays user-friendly error message
- Allows error recovery

---

## Summary

This architecture document provides a complete map of the AI Dialogue Platform codebase, including:

- **12 major sections** covering all aspects of the system
- **Complete file structure** with descriptions
- **All routes and APIs** (Socket.IO events)
- **Database schema** with all tables and operations
- **LLM provider system** with all implementations
- **Component hierarchy** with all props and state
- **Data flow diagrams** for all major processes
- **Configuration details** for all config files
- **Complete import/export map** showing all dependencies
- **Type system** with all interfaces
- **Utilities and helpers** with all functions

The document serves as a comprehensive reference for understanding, maintaining, and extending the codebase.

---

**Last Updated:** December 2024
**Version:** 1.3.0 (Updated with security enhancements and code quality improvements)

**Recent Updates:**

- **Security Enhancements:**
  - Implemented proper Socket.IO authentication with NextAuth session parsing
  - Activated DOMPurify for XSS protection in MessageBubble component
  - Added production validation for NEXTAUTH_SECRET to fail fast if missing
  - Anonymous connections blocked in production mode

- **Code Quality Improvements:**
  - Removed `any` types, replaced with proper type guards
  - Fixed ESLint disables with proper ref usage
  - Refactored large `processDiscussionDialogueRounds()` function into smaller, maintainable functions
  - Improved type safety throughout codebase

**Previous Updates:**

- Removed deprecated `needs-user-input` event handler
- Added toast notification system (react-hot-toast) for user feedback
- Implemented file backup system with periodic backups and retention policy
- Added log sanitization to remove sensitive data from logs
- Added startup cleanup routine for orphaned temp files
- Implemented Socket.IO acknowledgments for critical events with timeout handling
- Added new configuration constants (backup, session, LLM timeouts, security)
- Enhanced error handling with acknowledgment timeouts
- Added rate limiting to all socket handlers
- Implemented Redis-based distributed rate limiting
- Added input sanitization (DOMPurify)
- Implemented request timeouts for LLM providers
- Added environment validation on startup
- Implemented structured logging (Winston)
- Added database WAL mode and health checks
- Added security headers (CSP, HSTS, etc.)
- Added error boundaries
- Added health check endpoint
- Implemented graceful shutdown
- Added file size validation
- Added transaction support
- Fixed memory leaks
- Improved CORS configuration
- Added UUID validation
- Optimized database queries
- Standardized error messages

## 13. Monitoring & Observability

### Overview

The platform includes comprehensive monitoring and observability features for production operations.

### Metrics Collection

**Location:** `src/lib/monitoring/metrics.ts`, `src/lib/monitoring/collectors.ts`

**Features:**
- Request rates (per operation type)
- Error rates (per error type, per operation)
- Response times (p50, p95, p99)
- LLM API latency (per provider)
- Token usage (input/output per provider)
- Active discussions count
- Socket connection count
- Rate limit hits (per operation)
- Retry attempts and success rates

**Storage:**
- In-memory metrics store with periodic aggregation
- Redis-backed metrics for distributed deployments
- Metrics export endpoint (`/api/metrics`) for Prometheus format

### Health Checks

**Location:** `src/app/api/health/route.ts`

**Checks:**
- Database connectivity and query performance
- Redis connectivity (if enabled)
- LLM provider availability (all providers)
- Disk space (database and file storage)
- Memory usage
- Active socket connections

**Health Levels:**
- `healthy`: All systems operational
- `degraded`: Some systems degraded but service available
- `unhealthy`: Critical systems unavailable

### Performance Monitoring

**Location:** `src/lib/monitoring/performance.ts`

**Features:**
- Request duration tracking
- Database query timing
- LLM API call timing
- File I/O operations timing
- Socket event processing time
- Slow operation detection (configurable thresholds)
- Performance bottleneck identification

### Structured Logging

**Location:** `src/lib/monitoring/log-context.ts`

**Features:**
- Correlation IDs for request tracking
- Structured logging with consistent fields
- Log sampling for high-volume operations
- Error context enrichment
- JSON format for log aggregation

## 14. Cost Tracking & Optimization

### Overview

The platform tracks LLM API costs and provides optimization strategies.

### Cost Tracking

**Location:** `src/lib/cost-tracking/cost-calculator.ts`, `src/lib/cost-tracking/provider-costs.ts`

**Features:**
- Token usage tracking per provider (input/output)
- Cost calculation based on provider pricing
- Cost aggregation:
  - Per discussion cost
  - Per user cost
  - Daily/weekly/monthly totals
- Cost storage in database (`cost_tracking` table)
- Cost reporting endpoint (`/api/costs`)

### Cost Optimization

**Location:** `src/lib/cost-tracking/optimizer.ts`

**Strategies:**
- Provider selection based on cost (when multiple available)
- Token usage optimization:
  - System prompt caching (reduce repeated tokens)
  - Summary optimization
  - Context window optimization
- Cost alerts (daily/weekly/monthly budgets)
- Cost reporting dashboard data

### Provider Pricing

**Configuration:**
- Groq: $0.27 per 1M tokens (input/output)
- Mistral: $2.50/$7.50 per 1M tokens (input/output)
- OpenRouter: Varies by model (configurable)

## 15. Resilience & Circuit Breakers

### Circuit Breakers

**Location:** `src/lib/resilience/circuit-breaker.ts`

**Features:**
- Circuit breaker per LLM provider
- Failure threshold (default: 5 failures in 60s)
- Half-open state after cooldown (default: 30s)
- Success threshold to close (default: 2 successes)
- Automatic provider fallback when circuit is open
- Circuit breaker metrics and monitoring

**States:**
- `closed`: Normal operation
- `open`: Blocking requests due to failures
- `half-open`: Testing if service recovered

### Provider Health Monitoring

**Location:** `src/lib/llm/provider-health.ts`

**Features:**
- Success rate tracking (last 100 requests)
- Average latency monitoring
- Error rate by type
- Availability percentage
- Health-based provider selection
- Automatic provider rotation on health degradation
- Provider health endpoint (`/api/llm/health`)

### Graceful Degradation

**Location:** `src/lib/resilience/degradation.ts`

**Strategies:**
- Reduce max tokens when providers struggling
- Skip non-critical operations (e.g., question generation)
- Queue operations when system overloaded
- Return cached responses when available
- System load detection (CPU, memory, active requests)
- Automatic degradation triggers
- User notification of degraded service

### Error Handling

**Location:** `src/lib/socket/error-deduplication.ts`, `src/lib/utils/retry.ts`

**Features:**
- Error deduplication (prevents duplicate error emissions)
- Error classification (Transient, Recoverable, Permanent)
- Retry logic with exponential backoff
- Jitter to prevent thundering herd
- Retryable error detection (429, 503, network timeouts)
- State preservation on transient errors

## 16. Scalability & Performance

### Caching Strategy

**Location:** `src/lib/cache/response-cache.ts`, `src/lib/cache/prompt-cache.ts`

**Features:**
- Response caching (optional, for identical prompts)
- System prompt token count caching
- Redis-backed caching with TTL
- Cache invalidation strategies
- Cache hit/miss metrics

### Rate Limiting

**Location:** `src/lib/rate-limit.ts`

**Features:**
- Operation-specific rate limiting:
  - Start dialogue: 3 per minute
  - Proceed dialogue: 10 per minute
  - Submit answers: 10 per minute
  - Generate questions: 5 per minute
  - Generate summary: 2 per minute
- Redis-backed distributed rate limiting
- In-memory fallback
- Rate limit info in error responses

### Database Optimization

**Location:** `src/lib/db/schema.ts`

**Indexes:**
- `discussions.user_id` (user lookup)
- `discussions.created_at` (time-based queries)
- `discussions.is_resolved` (filtering resolved discussions)
- `cost_tracking.discussion_id`, `cost_tracking.user_id`, `cost_tracking.timestamp`

**Features:**
- WAL mode for better concurrent performance
- Connection health checks
- Query timeout handling

### Memory Management

**Location:** `src/lib/resources/memory-manager.ts`

**Features:**
- Memory usage monitoring
- Memory leak detection
- Automatic cleanup of:
  - Expired rate limit entries
  - Old connection tracking data
  - Stale cache entries
  - Completed discussion contexts
- Memory pressure handling

### Alerting System

**Location:** `src/lib/alerting/alerts.ts`

**Alert Conditions:**
- High error rate (> 5% in 5 minutes)
- Provider unavailability (all providers down)
- Rate limit exhaustion
- Database issues
- Disk space low (< 10% free)
- Cost threshold exceeded
- Performance degradation

**Alert Channels:**
- Log-based alerts
- Webhook notifications (optional)
- Email notifications (optional, future)

### Monitoring Dashboard

**Location:** `src/app/api/monitoring/dashboard/route.ts`

**Features:**
- System health summary
- Error rates by type
- Provider health status
- Cost summary
- Performance metrics
- Active discussions count
- Circuit breaker status
- Active alerts

### Configuration Management

**Location:** `src/lib/config/validator.ts`, `src/lib/config/feature-flags.ts`

**Features:**
- Configuration validation on startup
- Feature flag system for gradual rollout
- Helpful error messages for misconfiguration
- Default value validation

### Scalability Considerations

**Current Architecture:**
- SQLite database (suitable for moderate scale)
- File-based storage (suitable for moderate scale)
- In-memory rate limiting (with Redis option for distributed)

**Future Scalability Path:**
- Database migration: SQLite → PostgreSQL
- File storage migration: filesystem → object storage (S3, etc.)
- Horizontal scaling: Multiple instances with shared Redis
- Multi-region deployment (future)

**Maintained By:** Development Team
