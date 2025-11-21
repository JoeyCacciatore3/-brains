# Action Plan: Making LLM Discussion Workflow Fully Operational

## Critical Fixes (Do First)

### 1. Remove Deprecated Code
**File:** `src/lib/socket/client.ts`
- [ ] Remove `needs-user-input` event handler (lines ~250-260)
- [ ] Remove `needsUserInput` state variable
- [ ] Update component to only use `waitingForAction`

**File:** `docs/SOCKET_EVENTS.md`  
- [ ] Remove or mark `needs-user-input` event as fully deprecated

### 2. Add User Feedback Notifications
**Create:** `src/lib/components/ui/Toast.tsx`
- [ ] Create toast notification component
- [ ] Add toast context provider

**Update:** `src/lib/components/dialogue/ActionButtons.tsx`
- [ ] Add success toast when summary generated
- [ ] Add success toast when questions generated

**Update:** `src/lib/components/dialogue/RoundAccordion.tsx`
- [ ] Add success toast for copy to clipboard action

### 3. Implement File Backup System
**Create:** `src/lib/discussions/backup-manager.ts`
```typescript
export async function backupDiscussion(userId: string, discussionId: string): Promise<void> {
  // Copy files to backup directory with timestamp
}

export async function schedulePeriodicBackups(): void {
  // Run backups every hour for active discussions
}
```

### 4. Fix Security Issues
**Update:** `src/lib/logger.ts`
- [ ] Add sanitization function to remove sensitive data from logs
- [ ] Apply to all user input logging

**Create:** `src/lib/security/file-scanner.ts`
- [ ] Integrate with ClamAV or similar for virus scanning
- [ ] Apply to all file uploads before processing

## Operational Enhancements (Do Second)

### 5. Add Startup Cleanup
**Update:** `server.ts`
```typescript
// Add after line 36
import { cleanupOrphanedTempFiles } from './src/lib/discussions/temp-cleanup';
await cleanupOrphanedTempFiles();
```

### 6. Implement Socket Acknowledgments
**Update:** `src/lib/socket/handlers.ts`
- [ ] Add acknowledgment callbacks to critical events:
  - `start-dialogue`
  - `user-input` 
  - `submit-answers`

**Update:** `src/lib/socket/client.ts`
- [ ] Handle acknowledgments with timeout

### 7. Add Redis Caching
**Create:** `src/lib/cache/discussion-cache.ts`
```typescript
export async function getCachedDiscussion(discussionId: string): Promise<DiscussionData | null>
export async function setCachedDiscussion(discussionId: string, data: DiscussionData): Promise<void>
export async function invalidateDiscussionCache(discussionId: string): Promise<void>
```

### 8. Performance Optimization
**Update:** `src/lib/components/dialogue/RoundAccordion.tsx`
- [ ] Implement react-window for virtual scrolling
- [ ] Lazy load round content

## Configuration Updates

### 9. Environment Variables
**Add to `.env.example`:**
```bash
# Session Configuration
SESSION_TIMEOUT_MINUTES=1440

# LLM Provider Timeouts (ms)
LLM_TIMEOUT_GROQ=60000
LLM_TIMEOUT_MISTRAL=90000
LLM_TIMEOUT_OPENROUTER=120000

# File Scanning
ENABLE_VIRUS_SCAN=true
CLAMAV_HOST=localhost
CLAMAV_PORT=3310

# Backup Configuration  
BACKUP_ENABLED=true
BACKUP_RETENTION_DAYS=30
```

### 10. Update Configuration Files
**Update:** `src/lib/config.ts`
- [ ] Add new configuration constants for timeouts
- [ ] Add backup configuration

## Testing Requirements

### 11. Add Tests for Fixed Issues
**Create:** `tests/unit/lib/socket/acknowledgments.test.ts`
- [ ] Test acknowledgment timeouts
- [ ] Test retry logic

**Create:** `tests/unit/lib/security/sanitization.test.ts`  
- [ ] Test log sanitization
- [ ] Test file scanning

## Documentation Updates

### 12. Update Documentation
**Update:** `docs/ARCHITECTURE.md`
- [ ] Remove references to deprecated events
- [ ] Add backup system documentation
- [ ] Add caching strategy documentation

**Create:** `docs/DEPLOYMENT.md`
- [ ] Production deployment guide
- [ ] Environment variable reference
- [ ] Monitoring setup
- [ ] Backup and recovery procedures

## Quick Start Commands

```bash
# Install new dependencies
npm install react-hot-toast react-window clamscan

# Run tests after changes
npm test

# Build and verify
npm run build

# Start with new features
npm run dev
```

## Verification Checklist

After implementing fixes:
- [ ] All deprecated code removed
- [ ] Toast notifications appear for all user actions
- [ ] Files are backed up hourly
- [ ] Logs do not contain sensitive user data
- [ ] Socket events are acknowledged
- [ ] Performance improved with virtual scrolling
- [ ] Virus scanning works for file uploads
- [ ] Redis caching reduces file I/O
- [ ] All tests pass
- [ ] Documentation is updated

## Estimated Time: 2-3 days for critical fixes, 1 week for all enhancements