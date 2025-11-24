# AI Dialogue Platform

A production-ready Next.js application where three AI personas collaborate through dialogue to solve problems and analyze topics. Solver AI, Analyzer AI, and Moderator AI engage in collaborative discussion, with each AI contributing their unique perspective in every round. The platform features a beautiful hero-section interface where users can input a topic and watch the AIs work together until they reach a solution.

## Features

- **Triple AI System**: Three distinct AI personas work together:
  - **Solver AI**: Systematic problem-solver that breaks down problems and proposes solutions
  - **Analyzer AI**: Deep analytical thinker that examines assumptions and explores edge cases
  - **Moderator AI**: Participates as a third AI in discussions, guiding, clarifying, synthesizing ideas, and keeping the discussion focused and productive
- **Hero-Only UI**: Clean, focused single-page experience with no navigation complexity
- **Modern UI Design**: Black background with white text and green border accents for a sleek, terminal-inspired aesthetic
- **Concise AI Responses**: Optimized token limits (1000 tokens default, configurable via MAX_TOKENS env var) for focused and complete AI dialogue
- **Initial Topic Display**: The original topic/problem remains visible during the discussion for easy reference
- **Multi-LLM Support**: Integrates with Groq, Mistral, and OpenRouter APIs with automatic fallback
- **User Authentication**: OAuth authentication with GitHub for user-specific discussions
- **Discussion System**: File-based storage (JSON + Markdown) for persistent, user-specific discussions
- **Token Management**: Accurate token counting using tiktoken with automatic context management for long discussions
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

- Node.js 20.9.0 or higher
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
│   │   │   └── auth/          # Authentication API
│   │   ├── layout.tsx         # Root layout (with ErrorBoundary)
│   │   ├── page.tsx           # Home page (hero section)
│   │   └── globals.css        # Global styles
│   ├── components/            # React components
│   │   ├── ErrorBoundary.tsx  # Error boundary component
│   │   ├── dialogue/          # Dialogue-specific components
│   │   └── ui/                # Reusable UI components
│   ├── lib/                   # Utility libraries
│   │   ├── llm/               # LLM integration
│   │   │   ├── providers/     # LLM provider implementations
│   │   │   ├── resolver.ts    # Resolution detection
│   │   │   └── index.ts       # Unified interface
│   │   ├── socket/             # Socket.IO integration
│   │   │   ├── client.ts       # Client-side socket hook
│   │   │   └── handlers.ts     # Server-side socket handlers
│   │   ├── db/                 # Database operations
│   │   │   ├── discussions.ts   # Discussion CRUD (primary)
│   │   │   ├── schema.ts        # Database schema
│   │   │   ├── index.ts         # Database connection
│   │   │   └── redis.ts         # Redis client
│   │   ├── validation.ts      # Zod schemas
│   │   ├── rate-limit.ts       # Rate limiting (Redis + in-memory)
│   │   ├── logger.ts          # Winston logging
│   │   ├── env-validation.ts  # Environment validation
│   │   ├── errors.ts          # Standardized error codes
│   │   ├── discussion-context.ts # LLM prompt formatting
│   │   └── utils.ts            # Utility functions
│   └── types/                  # TypeScript types
├── tests/                     # Test files
│   ├── unit/                  # Unit tests
│   ├── integration/          # Integration tests
│   └── e2e/                   # E2E tests
└── .github/                   # GitHub workflows
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

| Variable                  | Description                                             | Required                                                   |
| ------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| `GROQ_API_KEY`            | Groq API key for Solver AI                              | Yes (at least one LLM key)                                 |
| `MISTRAL_API_KEY`         | Mistral API key for Analyzer AI                         | Yes (at least one LLM key)                                 |
| `OPENROUTER_API_KEY`      | OpenRouter API key (fallback, supports multiple models) | Recommended                                                |
| `NEXT_PUBLIC_APP_URL`     | Application URL for client-side                         | Recommended                                                |
| `APP_URL`                 | Server-side application URL for CORS                    | Optional (falls back to NEXT_PUBLIC_APP_URL)               |
| `DATABASE_PATH`           | Database file path                                      | No (default: `data/conversations.db`)                      |
| `LOG_LEVEL`               | Logging level                                           | No (default: `info` in production, `debug` in development) |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window                                 | No (default: 10)                                           |
| `RATE_LIMIT_WINDOW_MS`    | Rate limit window in ms                                 | No (default: 60000)                                        |
| `REDIS_URL`               | Redis connection string                                 | No (optional, for distributed rate limiting)               |
| `REDIS_HOST`              | Redis hostname                                          | No (default: `localhost`, used if REDIS_URL not set)       |
| `REDIS_PORT`              | Redis port                                              | No (default: 6379)                                         |
| `REDIS_PASSWORD`          | Redis password                                          | No                                                         |
| `GITHUB_CLIENT_ID`        | GitHub OAuth client ID                                  | No (optional, for authentication)                          |
| `GITHUB_CLIENT_SECRET`    | GitHub OAuth client secret                              | No (optional, for authentication)                          |
| `NEXTAUTH_SECRET`         | NextAuth secret for JWT signing                         | No (optional, for authentication)                          |
| `DISCUSSION_TOKEN_LIMIT`  | Token limit for discussions                             | No (default: 4000)                                         |

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
