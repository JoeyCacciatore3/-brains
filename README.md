# AI Dialogue Platform

A production-ready Next.js application where three AI personas collaborate through dialogue to solve problems and analyze topics. Solver AI, Analyzer AI, and Moderator AI engage in collaborative discussion, with each AI contributing their unique perspective in every round. The platform features a beautiful hero-section interface where users can input a topic and watch the AIs work together until they reach a solution.

## Features

- **Triple AI System**: Three distinct AI personas work together:
  - **Solver AI**: Systematic problem-solver that breaks down problems and proposes solutions
  - **Analyzer AI**: Deep analytical thinker that examines assumptions and explores edge cases
  - **Moderator AI**: Participates as a third AI in discussions, guiding, clarifying, synthesizing ideas, and keeping the discussion focused and productive
- **Hero-Only UI**: Clean, focused single-page experience with no navigation complexity
- **Modern UI Design**: Black background with white text and green border accents for a sleek, terminal-inspired aesthetic
- **Concise AI Responses**: Optimized token limits (2000 tokens default, configurable via MAX_TOKENS env var) for focused and complete AI dialogue
- **Initial Topic Display**: The original topic/problem remains visible during the discussion for easy reference
- **Multi-LLM Support**: Integrates with Groq, Mistral, and OpenRouter APIs with automatic fallback
- **User Authentication**: OAuth authentication with GitHub for user-specific discussions
- **Discussion System**: File-based storage (JSON + Markdown) for persistent, user-specific discussions
- **Token Management**: Accurate token counting using tiktoken with automatic context management for long discussions. Standardized token estimation (3.5 chars/token) across all components for consistency.
- **Automatic Summarization**: Intelligent summarization when discussions reach token limits (default: 4000 tokens, 50% of 8K context with safety buffer)
- **Three-Way Discussion**: Each round includes responses from all three AIs (Analyzer → Solver → Moderator), creating rich, multi-perspective conversations
- **Compact Message Bubbles**: Smaller, scrollable message containers (max height 250px) for efficient space usage
- **Discussion History**: View and manage your discussion history via API
- **Resolution Detection**: Intelligent algorithm detects when AIs have reached a solution
- **File Upload**: Support for images and PDFs to provide context to the AIs (PDF text extraction for OpenRouter)
- **Real-time Streaming**: Messages appear as they're generated for better UX
- **Rate Limiting**: Built-in protection against API abuse with Redis support for distributed deployments (always enforces limits, even when Redis unavailable)
- **File Locking**: Distributed file locking (Redis + in-memory) prevents race conditions in concurrent operations
- **Data Reconciliation**: Automatic reconciliation system to sync database from files and detect inconsistencies
- **Input Sanitization**: XSS protection using DOMPurify for all user-generated content (actively implemented)
- **Socket.IO Authentication**: Proper NextAuth session-based authentication for WebSocket connections
- **Production Security**: Anonymous connections blocked in production, NEXTAUTH_SECRET validation
- **Structured Logging**: Winston-based logging for production monitoring
- **Health Checks**: `/api/health` endpoint for deployment orchestration
- **Error Boundaries**: React error boundaries for graceful error handling
- **Request Timeouts**: 60-second timeouts for all LLM API calls
- **Type-Safe**: Full TypeScript coverage with strict mode
- **Production Ready**: Complete with security fixes, testing, CI/CD, and deployment configuration

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript (strict mode)
- **Authentication**: NextAuth v5 (OAuth: GitHub)
- **Real-time Communication**: Socket.IO
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Validation**: Zod
- **Database**: SQLite (better-sqlite3)
- **Caching/Rate Limiting**: Redis (optional, with in-memory fallback)
- **Tokenization**: tiktoken (for accurate token counting)
- **Testing**: Vitest (unit), Playwright (E2E)
- **CI/CD**: GitHub Actions
- **Deployment**: Vercel-ready

## Prerequisites

- Node.js 20.18.0 or higher
- npm 10.0.0 or higher
- API keys for at least one LLM provider:
  - [Groq API Key](https://console.groq.com/)
  - [Mistral API Key](https://console.mistral.ai/)
  - [OpenRouter API Key](https://openrouter.ai/)
- (Optional) OAuth credentials for authentication:
  - [GitHub OAuth](https://github.com/settings/developers)

## Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd @brains
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   ```bash
   cp env.example .env.local
   ```

4. **Edit `.env.local` and add your API keys**

   ```env
   GROQ_API_KEY=your_groq_api_key_here
   MISTRAL_API_KEY=your_mistral_api_key_here
   OPENROUTER_API_KEY=your_openrouter_api_key_here
   NEXT_PUBLIC_APP_URL=http://localhost:3000

   # Optional: OAuth authentication (see OAuth Setup section below for detailed instructions)
   NEXTAUTH_URL=http://localhost:3000
   NEXTAUTH_SECRET=your_nextauth_secret
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret
   ```

5. **Start the development server**

   ```bash
   npm run dev
   ```

   The browser will automatically open to [http://localhost:3000](http://localhost:3000). If it doesn't open automatically, you can manually navigate to that URL.

## OAuth Authentication Setup

The platform supports OAuth authentication with GitHub. Setting up OAuth is optional but recommended for production use.

### Prerequisites

- A GitHub account (for GitHub OAuth)

### GitHub OAuth Setup

1. **Go to GitHub Developer Settings**
   - Visit [https://github.com/settings/developers](https://github.com/settings/developers)
   - Sign in to your GitHub account

2. **Create a New OAuth App**
   - Click "New OAuth App"
   - Fill in the application details:
     - **Application name**: "AI Dialogue Platform" (or your preferred name)
     - **Homepage URL**:
       - Development: `http://localhost:3000`
       - Production: `https://yourdomain.com`
     - **Authorization callback URL**:
       - Development: `http://localhost:3000/api/auth/callback/github`
       - Production: `https://yourdomain.com/api/auth/callback/github`

3. **Copy Credentials**
   - After creating the app, you'll see the Client ID
   - Click "Generate a new client secret" to get the Client Secret
   - Add them to your `.env.local` file:
     ```env
     GITHUB_CLIENT_ID=your_github_client_id_here
     GITHUB_CLIENT_SECRET=your_github_client_secret_here
     ```

### NextAuth Configuration

1. **Generate NEXTAUTH_SECRET**
   - Generate a secure random secret:
     ```bash
     openssl rand -base64 32
     ```
   - Or use an online generator: [https://generate-secret.vercel.app/32](https://generate-secret.vercel.app/32)

2. **Set NEXTAUTH_URL**
   - Development: `http://localhost:3000`
   - Production: Your production domain (e.g., `https://yourdomain.com`)

3. **Add to `.env.local`**
   ```env
   NEXTAUTH_SECRET=your_generated_secret_here
   NEXTAUTH_URL=http://localhost:3000
   ```

### Complete Environment Variables Example

```env
# LLM API Keys (Required)
GROQ_API_KEY=your_groq_api_key_here
MISTRAL_API_KEY=your_mistral_api_key_here
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Application Settings
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development

# OAuth Authentication (Optional but recommended)
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_generated_secret_here
GITHUB_CLIENT_ID=your_github_client_id_here
GITHUB_CLIENT_SECRET=your_github_client_secret_here
```

### Testing OAuth

1. **Start the development server**
   ```bash
   npm run dev
   ```

2. **Navigate to the sign-in page**
   - Go to `http://localhost:3000/auth/signin`
   - Or click "Sign In" on the main page

3. **Test the OAuth flow**
   - Click "Sign in with GitHub"
   - Complete the OAuth consent flow
   - You should be redirected back to the home page
   - Your user menu should appear in the header

### Production Considerations

- **NEXTAUTH_SECRET**: Must be a strong, random value in production. Never use the default development secret.
- **NEXTAUTH_URL**: Must match your production domain exactly
- **OAuth Redirect URIs**: Must be updated in GitHub settings to use your production domain
- **HTTPS**: OAuth requires HTTPS in production. Ensure your deployment platform provides SSL certificates.

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Create production build
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run type-check` - Run TypeScript type checking
- `npm test` - Run unit tests
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:e2e` - Run end-to-end tests
- `npm run test:e2e:ui` - Run E2E tests with UI

### Project Structure

```
@brains/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API routes
│   │   │   ├── health/        # Health check endpoint
│   │   │   ├── discussions/   # Discussions API
│   │   │   ├── auth/          # Authentication API
│   │   │   ├── costs/         # Cost tracking API
│   │   │   ├── metrics/       # Metrics API (Prometheus format)
│   │   │   └── monitoring/    # Monitoring dashboard API
│   │   ├── layout.tsx         # Root layout (with ErrorBoundary)
│   │   ├── page.tsx           # Home page (hero section)
│   │   └── globals.css        # Global styles
│   ├── lib/                   # Core libraries
│   │   ├── components/        # React components
│   │   │   ├── ErrorBoundary.tsx  # Error boundary component
│   │   │   ├── dialogue/      # Dialogue-specific components
│   │   │   └── ui/            # Reusable UI components
│   │   ├── llm/               # LLM integration
│   │   │   ├── providers/     # LLM provider implementations
│   │   │   ├── resolver.ts    # Resolution detection
│   │   │   ├── provider-health.ts # Provider health monitoring
│   │   │   └── index.ts       # Unified interface
│   │   ├── socket/            # Socket.IO integration
│   │   │   ├── client.ts      # Client-side socket hook
│   │   │   ├── handlers.ts    # Server-side socket handlers
│   │   │   ├── auth-middleware.ts # Socket authentication
│   │   │   ├── authorization.ts # Socket authorization
│   │   │   ├── connection-manager.ts # Connection management
│   │   │   └── error-deduplication.ts # Error deduplication
│   │   ├── db/                # Database operations
│   │   │   ├── discussions.ts # Discussion CRUD (primary)
│   │   │   ├── schema.ts      # Database schema
│   │   │   ├── index.ts       # Database connection
│   │   │   ├── redis.ts       # Redis client
│   │   │   ├── migrations.ts # Database migrations
│   │   │   ├── monitoring.ts  # Monitoring database operations
│   │   │   └── transaction.ts # Transaction utilities
│   │   ├── discussions/       # Discussion file management
│   │   │   ├── file-manager.ts # File operations
│   │   │   ├── backup-manager.ts # Backup operations
│   │   │   ├── reconciliation.ts # Data reconciliation
│   │   │   ├── round-orchestrator.ts # Round orchestration
│   │   │   ├── round-processor.ts # Round processing
│   │   │   ├── round-validator.ts # Round validation
│   │   │   └── token-counter.ts # Token counting
│   │   ├── monitoring/        # Monitoring & metrics
│   │   │   └── metrics.ts     # Metrics collection
│   │   ├── alerting/          # Alerting system
│   │   │   └── index.ts       # Alert management
│   │   ├── cache/             # Caching system
│   │   │   ├── prompt-cache.ts # Prompt caching
│   │   │   └── response-cache.ts # Response caching
│   │   ├── cost-tracking/     # Cost tracking
│   │   │   ├── index.ts       # Cost tracking main
│   │   │   └── (additional cost tracking files)
│   │   ├── queue/             # Queue management
│   │   │   └── (queue implementation files)
│   │   ├── resilience/        # Resilience patterns
│   │   │   └── (circuit breaker, retry logic)
│   │   ├── resources/         # Resource management
│   │   │   └── (resource management files)
│   │   ├── config/             # Configuration
│   │   │   ├── validator.ts   # Config validation
│   │   │   └── (additional config files)
│   │   ├── utils/              # Utility functions
│   │   │   └── (utility files)
│   │   ├── validation.ts      # Zod schemas
│   │   ├── rate-limit.ts       # Rate limiting (Redis + in-memory)
│   │   ├── rate-limit-tier.ts  # Rate limit tiers
│   │   ├── logger.ts          # Winston logging
│   │   ├── client-logger.ts   # Client-side logging
│   │   ├── env-validation.ts  # Environment validation
│   │   ├── config.ts          # Centralized configuration
│   │   ├── errors.ts          # Standardized error codes
│   │   ├── discussion-context.ts # LLM prompt formatting
│   │   ├── memory-manager.ts  # Memory management
│   │   └── utils.ts          # Utility functions
│   └── types/                 # TypeScript types
│       └── index.ts           # Type definitions
├── tests/                     # Test files
│   ├── unit/                  # Unit tests
│   ├── integration/           # Integration tests
│   ├── e2e/                   # E2E tests
│   ├── load/                  # Load tests
│   └── utils/                 # Test utilities
├── docs/                      # Documentation
│   ├── ARCHITECTURE.md        # System architecture
│   ├── DEPLOYMENT.md          # Deployment guide
│   ├── MONITORING.md          # Monitoring documentation
│   ├── OPERATIONS.md          # Operations guide
│   ├── ALERTING.md            # Alerting documentation
│   ├── LLM_WORKFLOW.md        # LLM workflow
│   ├── SOCKET_EVENTS.md       # Socket.IO events
│   └── ROUND_UTILITIES.md     # Round utilities
├── scripts/                   # Build scripts
│   └── pre-build-check.js     # Pre-build validation
└── .github/                   # GitHub workflows
    └── workflows/             # CI/CD workflows
```

## API Documentation

The application uses **Socket.IO** for real-time bidirectional communication between the client and server, plus a **health check endpoint** for deployment orchestration.

### Health Check Endpoint

**GET `/api/health`**

Returns system health status for deployment orchestration.

**Response:**

```json
{
  "status": "UP",
  "timestamp": "2024-12-01T12:00:00.000Z",
  "components": {
    "database": { "status": "UP" },
    "groq_llm": { "status": "UP" }
  }
}
```

**Status Codes:**

- `200 OK`: All checks pass
- `503 Service Unavailable`: Any check fails

**Checks:**

- Database connectivity
- LLM provider availability (at least one required)
- Redis connectivity (optional, if configured)

### Discussions Endpoint

**GET `/api/discussions`**

Returns all discussions for the authenticated user.

**Authentication:** Required (NextAuth session)

**Response:**

```json
{
  "discussions": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "topic": "Discussion topic",
      "created_at": 1234567890,
      "updated_at": 1234567890,
      "is_resolved": 0,
      "token_count": 1500,
      "token_limit": 4000
    }
  ]
}
```

**Status Codes:**

- `200 OK`: Success
- `401 Unauthorized`: Not authenticated
- `404 Not Found`: User not found
- `500 Internal Server Error`: Server error

### Cost Tracking Endpoint

**GET `/api/costs`**

Returns cost tracking and reporting data.

**Query Parameters:**

- `userId` (optional): Filter costs by user ID
- `startDate` (optional): Start date for cost range (ISO 8601)
- `endDate` (optional): End date for cost range (ISO 8601)

**Response:**

```json
{
  "timestamp": "2024-12-01T12:00:00.000Z",
  "costByProvider": {
    "groq": 0.15,
    "mistral": 0.25,
    "openrouter": 0.10
  },
  "dailyCosts": [
    {
      "date": "2024-12-01",
      "cost": 0.50
    }
  ],
  "budget": {
    "current": 2.50,
    "limit": 10.00,
    "percentage": 0.25,
    "exceeded": false
  },
  "userCost": 0.15
}
```

**Status Codes:**

- `200 OK`: Success
- `500 Internal Server Error`: Server error

**Note:** See [`docs/MONITORING.md`](./docs/MONITORING.md) for detailed monitoring documentation.

### Metrics Endpoint

**GET `/api/metrics`**

Returns system metrics in Prometheus format for monitoring integration.

**Response:** Prometheus-formatted text

```
# TYPE http_requests_total counter
http_requests_total 1234
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_sum 45.2
http_request_duration_seconds_count 1234
http_request_duration_seconds_avg 0.036
```

**Content-Type:** `text/plain; version=0.0.4`

**Status Codes:**

- `200 OK`: Success
- `500 Internal Server Error`: Server error

**Available Metrics:**

- Counter metrics: Request counts, error counts
- Gauge metrics: Active discussions, socket connections
- Histogram metrics: Request duration, response times

**Note:** See [`docs/MONITORING.md`](./docs/MONITORING.md) for detailed metrics documentation.

### Monitoring Dashboard Endpoint

**GET `/api/monitoring/dashboard`**

Returns comprehensive system health and metrics data for dashboard display.

**Response:**

```json
{
  "timestamp": "2024-12-01T12:00:00.000Z",
  "health": {
    "database": true,
    "redis": true,
    "llm": true
  },
  "metrics": {
    "errorRate": 0.02,
    "totalRequests": 1234,
    "totalErrors": 25,
    "activeDiscussions": 5,
    "socketConnections": 10
  },
  "providers": {
    "availability": {
      "groq": true,
      "mistral": true,
      "openrouter": true
    },
    "health": {
      "groq": {
        "successRate": 0.98,
        "avgLatency": 1200
      }
    }
  },
  "circuitBreakers": {
    "groq": {
      "state": "closed",
      "failures": 0
    }
  },
  "alerts": [
    {
      "id": "alert-1",
      "type": "error_rate",
      "severity": "warning",
      "message": "Error rate above threshold",
      "timestamp": "2024-12-01T12:00:00.000Z"
    }
  ],
  "costs": {
    "byProvider": {
      "groq": 0.15,
      "mistral": 0.25
    },
    "daily": [
      {
        "date": "2024-12-01",
        "cost": 0.50
      }
    ],
    "budget": {
      "current": 2.50,
      "limit": 10.00,
      "percentage": 0.25,
      "exceeded": false
    }
  },
  "system": {
    "load": {
      "cpu": 0.45,
      "memory": 0.60
    }
  }
}
```

**Status Codes:**

- `200 OK`: Success
- `500 Internal Server Error`: Server error

**Note:** See [`docs/MONITORING.md`](./docs/MONITORING.md) for detailed monitoring documentation.

### Socket.IO Events

#### Client → Server Events

**`start-dialogue`**
Start a new dialogue between the three AI personas.

```typescript
socket.emit('start-dialogue', {
  topic: "How can we improve user engagement?",
  files?: [
    {
      name: "document.pdf",
      type: "application/pdf",
      size: 1024000,
      base64?: "base64-encoded-content"
    }
  ]
});
```


#### Server → Client Events

**`discussion-started`**
Emitted when a new discussion is created.

```typescript
socket.on(
  'discussion-started',
  (data: {
    discussionId: string | null; // null if hasActiveDiscussion is true
    hasActiveDiscussion: boolean;
  }) => {
    // Handle discussion start
    if (data.discussionId) {
      // Reset state and set discussion ID
    }
  }
);
```

**`message-start`**
Emitted when an AI starts generating a message.

```typescript
socket.on(
  'message-start',
  (data: {
    discussionId: string; // Standardized: always discussionId
    persona: string;
    turn: number;
  }) => {
    // Handle message start
  }
);
```

```typescript
socket.on('message-start', (data: { discussionId: string; persona: string; turn: number }) => {
  // Handle message start
});
```

**`message-chunk`**
Emitted for each chunk of streaming response.

```typescript
socket.on(
  'message-chunk',
  (data: {
    discussionId: string; // Standardized: always discussionId
    chunk: string;
  }) => {
    // Append chunk to current message
  }
);
```

**`message-complete`**
Emitted when an AI finishes generating a message.

```typescript
socket.on(
  'message-complete',
  (data: {
    discussionId: string; // Standardized: always discussionId
    message: ConversationMessage;
  }) => {
    // Clear streaming state (round-complete is source of truth)
  }
);
```

**`needs-user-input`** ⚠️ DEPRECATED
This event is **NOT emitted** by the server. The system uses `waitingForAction` state from `round-complete` event instead. Users can provide input via action buttons after each round.

**Note:** Handler exists in client code but is never triggered. Use `round-complete` event and `waitingForAction` state instead.

**`conversation-resolved`**
Emitted when the AIs reach a resolution.

```typescript
socket.on(
  'conversation-resolved',
  (data: {
    discussionId: string; // Standardized: always discussionId (event name kept for backward compatibility)
  }) => {
    // Show resolution banner
  }
);
```

**`round-complete`**
Emitted when all three AIs in a round have finished responding (Analyzer → Solver → Moderator).

```typescript
socket.on(
  'round-complete',
  (data: {
    discussionId: string; // Standardized: always discussionId
    round: DiscussionRound;
  }) => {
    // Add round to rounds array (source of truth)
    // Display round with all three AI responses
    // Set waitingForAction = true
  }
);
```

**`questions-generated`**
Emitted when questions are generated after a round.

```typescript
socket.on(
  'questions-generated',
  (data: {
    discussionId: string; // Standardized: always discussionId
    questionSet: QuestionSet;
    roundNumber: number;
  }) => {
    // Display questions to user
  }
);
```

**`summary-created`**
Emitted when a summary is created for previous rounds.

```typescript
socket.on(
  'summary-created',
  (data: {
    discussionId: string; // Standardized: always discussionId
    summary: SummaryEntry;
  }) => {
    // Display summary banner
    // Update context with summary
  }
);
```

**`error`**
Emitted when an error occurs.

```typescript
socket.on(
  'error',
  (data: {
    discussionId?: string; // Standardized: always discussionId (optional)
    message: string;
    code?: string; // Error code (e.g., 'RATE_LIMIT_EXCEEDED')
  }) => {
    // Display error to user
  }
);
```

**Error Codes:**

- `RATE_LIMIT_EXCEEDED`: Rate limit exceeded
- `VALIDATION_ERROR`: Input validation failed
- `INVALID_DISCUSSION_ID`: Invalid discussion UUID format
- `INVALID_FILE_SIZE`: File exceeds maximum size
- `INVALID_FILE_TYPE`: Invalid file type
- `DISCUSSION_NOT_FOUND`: Discussion not found
- `DATABASE_ERROR`: Database error
- `LLM_PROVIDER_ERROR`: LLM provider error
- `LLM_TIMEOUT`: LLM request timeout
- `NO_LLM_PROVIDER_AVAILABLE`: No LLM providers available
- `NETWORK_ERROR`: Network error occurred
- `SOCKET_ERROR`: Socket connection error
- `INTERNAL_ERROR`: Internal server error
- `UNKNOWN_ERROR`: Unknown error occurred

## Environment Variables

> **Note:** For a complete list of all environment variables with detailed descriptions, see [`env.example`](./env.example).

### Required Variables

| Variable             | Description                                    | Required                                    |
| -------------------- | ---------------------------------------------- | ------------------------------------------- |
| `GROQ_API_KEY`       | Groq API key for Solver AI                     | Yes (at least one LLM key required)        |
| `MISTRAL_API_KEY`    | Mistral API key for Analyzer AI                | Yes (at least one LLM key required)       |
| `OPENROUTER_API_KEY` | OpenRouter API key (fallback, multiple models) | Recommended (at least one LLM key required) |

### Application Settings

| Variable              | Description                                    | Default                    |
| --------------------- | ---------------------------------------------- | -------------------------- |
| `NEXT_PUBLIC_APP_URL` | Application URL for client-side                | `http://localhost:3000`    |
| `APP_URL`             | Server-side application URL for CORS           | Falls back to `NEXT_PUBLIC_APP_URL` |
| `NODE_ENV`            | Environment mode (development/production)       | `development`              |
| `HOSTNAME`            | Server hostname                                | `localhost`                |
| `PORT`                | Server port (1-65535)                          | `3000`                     |
| `NEXT_PUBLIC_SOCKET_URL` | Custom Socket.IO server URL                | Falls back to `NEXT_PUBLIC_APP_URL` |

### LLM Configuration

| Variable                    | Description                                    | Default |
| --------------------------- | ---------------------------------------------- | ------- |
| `MAX_TOKENS`                | Maximum tokens per AI response                 | `2000`  |
| `MAX_TURNS`                 | Maximum number of AI exchanges per conversation | `20`    |
| `DISCUSSION_TOKEN_LIMIT`    | Token limit before summarization               | `4000`  |
| `OPENROUTER_FALLBACK_MODELS` | Comma-separated fallback models              | See `env.example` |
| `LLM_TIMEOUT_GROQ`          | Groq timeout in milliseconds                   | `60000` |
| `LLM_TIMEOUT_MISTRAL`       | Mistral timeout in milliseconds                | `90000` |
| `LLM_TIMEOUT_OPENROUTER`    | OpenRouter timeout in milliseconds             | `120000` |
| `ENABLE_TOKEN_SYNC_VALIDATION` | Enable token count sync validation          | `false` |
| `AUTO_REPAIR_TOKEN_SYNC`    | Auto-repair token count mismatches < 5%        | `false` |

### Database & Storage

| Variable           | Description                    | Default                      |
| ----------------- | ------------------------------ | ---------------------------- |
| `DATABASE_PATH`    | SQLite database file path      | `data/conversations.db`      |
| `DISCUSSIONS_DIR`  | Directory for discussion files | `data/discussions`           |
| `FILE_OPERATION_MAX_RETRIES` | Max retries for file operations | `3` |
| `FILE_OPERATION_RETRY_DELAY_MS` | Retry delay in milliseconds | `100` |

### Rate Limiting

| Variable                          | Description                    | Default |
| --------------------------------- | ------------------------------ | ------- |
| `RATE_LIMIT_MAX_REQUESTS`         | Max requests per window        | `10`    |
| `RATE_LIMIT_WINDOW_MS`            | Rate limit window in ms        | `60000` |
| `RATE_LIMIT_START_DIALOGUE`       | Rate limit for start dialogue  | `3`     |
| `RATE_LIMIT_PROCEED_DIALOGUE`     | Rate limit for proceed dialogue | `10`    |
| `RATE_LIMIT_SUBMIT_ANSWERS`       | Rate limit for submit answers  | `10`    |
| `RATE_LIMIT_GENERATE_QUESTIONS`   | Rate limit for generate questions | `5`  |
| `RATE_LIMIT_GENERATE_SUMMARY`     | Rate limit for generate summary | `2`    |

### Redis Configuration

| Variable        | Description                                    | Default     |
| --------------- | ---------------------------------------------- | ----------- |
| `REDIS_URL`     | Redis connection string                        | (optional)  |
| `REDIS_HOST`    | Redis hostname (used if REDIS_URL not set)     | `localhost` |
| `REDIS_PORT`    | Redis port                                     | `6379`      |
| `REDIS_PASSWORD` | Redis password                                | (optional)  |

### Authentication (OAuth)

| Variable              | Description                    | Required |
| --------------------- | ------------------------------ | -------- |
| `NEXTAUTH_URL`        | Base URL for OAuth callbacks   | Optional |
| `NEXTAUTH_SECRET`     | Secret key for JWT signing     | Optional |
| `GITHUB_CLIENT_ID`    | GitHub OAuth client ID          | Optional |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret     | Optional |

### Logging

| Variable                  | Description                    | Default                          |
| -------------------------- | ------------------------------ | -------------------------------- |
| `LOG_LEVEL`               | Logging level (debug/info/warn/error) | `info` (production), `debug` (development) |
| `NEXT_PUBLIC_LOG_LEVEL`   | Client-side log level          | `info`                           |
| `LOG_SAMPLING_RATE`       | Log sampling rate (0.0-1.0)    | `1.0`                            |
| `LOG_CORRELATION_ENABLED` | Enable log correlation IDs      | `true`                           |
| `LOG_STRUCTURED_FORMAT`   | Structured log format          | `json`                           |

### Session & Backup

| Variable                | Description                    | Default |
| ----------------------- | ------------------------------ | ------- |
| `SESSION_TIMEOUT_MINUTES` | Session timeout in minutes   | `1440`  |
| `BACKUP_ENABLED`        | Enable automatic backups       | `true`  |
| `BACKUP_RETENTION_DAYS` | Days to retain backups        | `30`    |
| `BACKUP_INTERVAL_HOURS` | Backup interval in hours       | `1`     |
| `BACKUPS_DIR`          | Directory for backups          | `data/backups` |

### Error Handling & Retry

| Variable                      | Description                    | Default |
| ----------------------------- | ------------------------------ | ------- |
| `ERROR_DEDUPLICATION_WINDOW_MS` | Error deduplication window   | `5000`  |
| `ERROR_THROTTLE_WINDOW_MS`   | Error throttle window         | `5000`  |
| `RETRY_MAX_ATTEMPTS`         | Maximum retry attempts        | `3`    |
| `RETRY_BASE_DELAY_MS`        | Base retry delay              | `1000`  |
| `RETRY_MAX_DELAY_MS`         | Maximum retry delay           | `30000` |
| `RETRY_JITTER_ENABLED`       | Enable retry jitter           | `true`  |

### Monitoring & Metrics

| Variable                        | Description                    | Default |
| ------------------------------- | ------------------------------ | ------- |
| `METRICS_ENABLED`               | Enable metrics collection      | `true`  |
| `METRICS_RETENTION_HOURS`      | Metrics retention period       | `24`    |
| `METRICS_AGGREGATION_INTERVAL_MS` | Metrics aggregation interval | `60000` |
| `PERFORMANCE_SLOW_THRESHOLD_MS` | Slow request threshold        | `5000`  |
| `PERFORMANCE_TRACK_ENABLED`     | Enable performance tracking   | `true`  |
| `DISK_SPACE_THRESHOLD`          | Disk space threshold (0.0-1.0) | `0.1`   |

### Cost Tracking

| Variable                    | Description                    | Default |
| --------------------------- | ------------------------------ | ------- |
| `COST_TRACKING_ENABLED`     | Enable cost tracking           | `true`  |
| `GROQ_INPUT_COST_PER_1M`    | Groq input cost per 1M tokens  | `0.27`  |
| `GROQ_OUTPUT_COST_PER_1M`   | Groq output cost per 1M tokens | `0.27`  |
| `MISTRAL_INPUT_COST_PER_1M` | Mistral input cost per 1M tokens | `2.50` |
| `MISTRAL_OUTPUT_COST_PER_1M` | Mistral output cost per 1M tokens | `7.50` |
| `OPENROUTER_INPUT_COST_PER_1M` | OpenRouter input cost per 1M tokens | `1.00` |
| `OPENROUTER_OUTPUT_COST_PER_1M` | OpenRouter output cost per 1M tokens | `3.00` |
| `COST_OPTIMIZATION_ENABLED` | Enable cost optimization       | `true`  |
| `DAILY_COST_BUDGET`         | Daily cost budget in USD       | `10.00` |
| `COST_ALERT_THRESHOLD`      | Cost alert threshold (0.0-1.0) | `0.8`   |

### Circuit Breaker

| Variable                          | Description                    | Default |
| --------------------------------- | ------------------------------ | ------- |
| `CIRCUIT_BREAKER_ENABLED`        | Enable circuit breaker          | `true`  |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | Failure threshold            | `5`     |
| `CIRCUIT_BREAKER_WINDOW_MS`      | Circuit breaker window          | `60000` |
| `CIRCUIT_BREAKER_COOLDOWN_MS`    | Circuit breaker cooldown        | `30000` |
| `CIRCUIT_BREAKER_SUCCESS_THRESHOLD` | Success threshold            | `2`     |
| `PROVIDER_HEALTH_CHECK_INTERVAL_MS` | Provider health check interval | `30000` |
| `PROVIDER_MIN_SUCCESS_RATE`      | Minimum provider success rate  | `0.95`  |
| `PROVIDER_MAX_LATENCY_MS`        | Maximum provider latency       | `10000` |

### Caching

| Variable              | Description                    | Default |
| --------------------- | ------------------------------ | ------- |
| `CACHE_ENABLED`       | Enable caching                  | `true`  |
| `CACHE_TTL_MS`        | Cache TTL in milliseconds      | `3600000` |
| `CACHE_MAX_SIZE`      | Maximum cache size             | `1000`  |
| `CACHE_RESPONSE_CACHING` | Enable response caching      | `false` |

### Alerting

| Variable                      | Description                    | Default |
| ----------------------------- | ------------------------------ | ------- |
| `ALERTS_ENABLED`              | Enable alerting                | `true`  |
| `ALERT_ERROR_RATE_THRESHOLD`  | Error rate threshold (0.0-1.0) | `0.05`  |
| `ALERT_DISK_SPACE_THRESHOLD`  | Disk space alert threshold     | `0.1`   |
| `ALERT_WEBHOOK_URL`           | Webhook URL for alerts         | (optional) |

### Memory Management

| Variable                      | Description                    | Default |
| ----------------------------- | ------------------------------ | ------- |
| `MEMORY_MONITORING_ENABLED`   | Enable memory monitoring       | `true`  |
| `MEMORY_CLEANUP_INTERVAL_MS`  | Memory cleanup interval         | `300000` |
| `MEMORY_PRESSURE_THRESHOLD`   | Memory pressure threshold      | `0.8`   |

### Graceful Degradation

| Variable                              | Description                    | Default |
| ------------------------------------- | ------------------------------ | ------- |
| `DEGRADATION_ENABLED`                 | Enable graceful degradation    | `true`  |
| `DEGRADATION_CPU_THRESHOLD`           | CPU threshold (0.0-1.0)        | `0.8`   |
| `DEGRADATION_MEMORY_THRESHOLD`        | Memory threshold (0.0-1.0)      | `0.8`   |
| `DEGRADATION_ACTIVE_REQUESTS_THRESHOLD` | Active requests threshold    | `100`   |

### Feature Flags

| Variable                              | Description                    | Default |
| ------------------------------------- | ------------------------------ | ------- |
| `FEATURE_METRICS_ENABLED`             | Enable metrics feature          | `true`  |
| `FEATURE_COST_TRACKING_ENABLED`       | Enable cost tracking feature    | `true`  |
| `FEATURE_CIRCUIT_BREAKER_ENABLED`     | Enable circuit breaker feature  | `true`  |
| `FEATURE_CACHING_ENABLED`             | Enable caching feature          | `true`  |
| `FEATURE_ALERTING_ENABLED`            | Enable alerting feature         | `true`  |
| `FEATURE_PERFORMANCE_MONITORING_ENABLED` | Enable performance monitoring | `true` |

### Security (Future Enhancement)

| Variable          | Description                    | Default     |
| ----------------- | ------------------------------ | ----------- |
| `ENABLE_VIRUS_SCAN` | Enable virus scanning         | `false`     |
| `CLAMAV_HOST`     | ClamAV hostname                | `localhost` |
| `CLAMAV_PORT`     | ClamAV port                    | `3310`      |

### External Services (Optional)

| Variable           | Description                    | Default |
| ------------------ | ------------------------------ | ------- |
| `SENTRY_DSN`       | Sentry DSN for error tracking  | (optional) |
| `VERCEL_ANALYTICS_ID` | Vercel Analytics ID        | (optional) |

## Testing

### Unit Tests

```bash
npm test
```

### E2E Tests

```bash
npm run test:e2e
```

### Coverage

```bash
npm run test:coverage
```

## Deployment

### Vercel (Recommended)

1. **Push your code to GitHub**

2. **Import project in Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your GitHub repository

3. **Add environment variables**
   - In Vercel project settings, add all required environment variables
   - Use the same keys from your `.env.local`

4. **Deploy**
   - Vercel will automatically deploy on every push to main

### Manual Deployment

1. **Build the application**

   ```bash
   npm run build
   ```

2. **Start production server**
   ```bash
   npm start
   ```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Run linter (`npm run lint`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Code Standards

- Follow ESLint rules (enforced by pre-commit hook)
- Use Prettier for formatting
- Write tests for new features
- Use TypeScript strict mode (no `any` types)
- Add JSDoc comments for public functions
- All database queries use proper TypeScript interfaces
- Server-side validation for all user inputs

## Troubleshooting

### API Key Errors

- Ensure all API keys are set in `.env.local`
- Check that keys are valid and have sufficient credits
- Verify environment variables are loaded (restart dev server)

### Build Errors

- Run `npm run type-check` to identify TypeScript errors
- Ensure all dependencies are installed (`npm install`)
- Clear `.next` folder and rebuild

### Rate Limiting

- Default limit is 10 requests per minute per IP
- Adjust `RATE_LIMIT_MAX_REQUESTS` in environment variables if needed

### LLM Provider Failures

- The system automatically falls back to alternative providers
- All LLM requests have 60-second timeouts
- Check API provider status pages
- Verify API keys are correct
- Check logs for detailed error messages

### Logging

- Structured logging using Winston
- Logs are JSON-formatted in production
- Check console output in development
- Log level controlled by `LOG_LEVEL` environment variable

### Redis Connection

- Redis is optional for rate limiting
- System falls back to in-memory rate limiting if Redis unavailable
- Check Redis connection if distributed rate limiting needed
- Verify `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT` configuration

## License

MIT License - see [LICENSE](LICENSE) file for details

## Support

For issues and questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Search existing GitHub issues
3. Create a new issue with detailed information

---

Built with ❤️ using Next.js, TypeScript, and modern web technologies.
