# Data Storage Architecture

## Single Source of Truth

This application uses a **dual-storage architecture** with clear separation of concerns:

### Database (SQLite) - Metadata & Indexing
**Primary source for:**
- Discussion metadata (id, topic, timestamps, status)
- User associations
- Token counts and limits
- Resolution status
- File paths (references to file storage)

**Operations:**
- Fast queries and lookups
- User-specific filtering
- Status tracking
- Indexing for performance

**Location:** `src/lib/db/discussions.ts`

### Files (JSON + Markdown) - Full Content
**Primary source for:**
- Complete round data
- All messages with full content
- Summaries
- Questions and answers
- Full discussion history

**Operations:**
- Content storage and retrieval
- Round management
- Message persistence
- Summary storage

**Location:** `src/lib/discussions/file-manager.ts`

## Data Access Layer

All data operations should go through the unified data access layer in `src/lib/data/index.ts` to ensure:
- Consistent data access patterns
- Proper validation
- Single source of truth enforcement
- No duplicate storage logic

## Rules

1. **Never store message content in database** - Only metadata goes to database
2. **Never store metadata in files** - Only content goes to files
3. **Always use the data access layer** - Don't access database or files directly
4. **File storage is authoritative for content** - Database syncs from files, not vice versa
5. **Database is authoritative for metadata** - Files reference database IDs
