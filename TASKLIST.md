# Browser Testing & Code Quality Task List

**Date:** 2024-12-XX
**Status:** In Progress - Manual Browser Testing Required

## Overview

This task list consolidates all pending and in-progress tasks from the browser testing and code quality plan. Only tasks that are NOT completed are included in this list. All completed phases (Phase 1, 6, 7, 8, 10, 11) have been excluded.

## Phase 2: Critical Path Browser Testing (User Journey)

**Status:** Pending - Requires manual browser testing

### Task 2.1: Initial Page Load & Connection

**Description:** Test the initial page load and Socket.IO connection establishment.

**Steps:**
1. Start development server:
   ```bash
   npm run dev
   ```
2. Open Chrome browser (latest stable version)
3. Clear browser cache and localStorage
   - Open DevTools (F12)
   - Go to Application tab
   - Clear Storage > Clear site data
4. Navigate to `http://localhost:3000`
5. Open DevTools (Console, Network, Application tabs)

**Expected Outcomes:**
- Page loads without errors
- Hero section displays correctly
- Connection status indicator shows "Connected"
- All UI elements are visible and properly styled
- No console errors on page load

**Files to Verify:**
- `src/app/page.tsx`
- `src/components/dialogue/DialogueHero.tsx`
- `src/lib/socket/client.ts`

**Verification Steps:**
- Check browser console for errors or warnings
- Verify Socket.IO connection in Network tab (should see WebSocket connection)
- Check connection state in UI (should show "Connected")
- Verify all visual elements render correctly

### Task 2.2: Start Dialogue (No Authentication) ✅ E2E Test Implemented

**Description:** Test starting a dialogue without user authentication.

**E2E Test:** Test 1 in `tests/e2e/dialogue.spec.ts`

**Steps:**
1. Navigate to `http://localhost:3000` (not signed in)
2. Enter a valid topic in the textarea (50-200 characters)
   - Example: "How can we improve remote team collaboration using modern technology tools?"
3. Verify "Start AI Dialogue" button is enabled
4. Click "Start AI Dialogue" button

**Expected Outcomes:**
- Button becomes disabled during processing
- Socket.IO events appear in Network tab
- Discussion starts (ID assigned)
- AI responses begin streaming
- Rounds display correctly
- No console errors

**Files to Verify:**
- `src/components/dialogue/InputSection.tsx`
- `src/lib/socket/handlers.ts`

**Verification Steps:**
- Watch for Socket.IO events: `start-discussion`, `round-complete`, etc.
- Verify discussion ID is assigned and displayed
- Check that AI responses start appearing
- Verify rounds are displayed in UI
- Check console for any errors

### Task 2.3: AI Conversation Streaming ✅ E2E Test Implemented

**Description:** Test that AI responses stream smoothly in real-time.

**E2E Test:** Test 3 in `tests/e2e/dialogue.spec.ts`

**Steps:**
1. Start a dialogue (see Task 2.2)
2. Watch AI responses stream in real-time
3. Observe persona badges, turn numbers, and message bubbles

**Expected Outcomes:**
- Streaming is smooth (no stuttering)
- Persona badges display correctly (Solver AI, Analyzer AI, Moderator AI)
- Turn numbers increment correctly
- Message bubbles render properly
- UI remains responsive during streaming
- Auto-scrolls to latest message

**Files to Check:**
- `src/components/dialogue/MessageBubble.tsx`
- `src/components/dialogue/RoundDisplay.tsx`
- `src/components/dialogue/DialogueHero.tsx` (scroll logic)

**Verification Steps:**
- Monitor streaming smoothness (no delays or jumps)
- Verify persona badges match responses (Solver AI, Analyzer AI, Moderator AI)
- **Verify response order: Solver AI responds first, then Analyzer AI, then Moderator AI in each round**
- Check turn numbers increment sequentially
- Verify message bubbles format correctly
- Test UI responsiveness (can still interact with other elements)
- Verify auto-scroll behavior (follows latest message)

### Task 2.4: Round Completion & Actions ✅ E2E Test Implemented

**Description:** Test round completion and action buttons functionality.

**E2E Tests:**
- Test 10: Generate Summary
- Test 11: Generate Questions
- Test 12: Proceed Dialogue
All in `tests/e2e/dialogue.spec.ts`

**Steps:**
1. Start a dialogue (see Task 2.2)
2. Wait for a round to complete (AI responses finish)
3. Verify "waitingForAction" state activates
4. Check for action buttons:
   - "Proceed Dialogue"
   - "Generate Questions"
   - "Generate Summary"
5. Test each action button individually

**Expected Outcomes:**
- Action buttons appear after round completion
- "Proceed Dialogue" starts next round correctly
- "Generate Questions" displays questions correctly
- "Generate Summary" displays summary correctly
- Each action updates state correctly

**Files to Verify:**
- `src/components/dialogue/ActionButtons.tsx`
- `src/components/dialogue/QuestionGenerator.tsx`
- `src/components/dialogue/RoundAccordion.tsx`

**Verification Steps:**
- Test "Proceed Dialogue" button:
  - Click button
  - Verify next round starts
  - Verify round number increments
  - Verify new AI responses begin
- Test "Generate Questions" button:
  - Click button
  - Verify questions appear
  - Verify questions are stored in files
  - Verify questions display correctly
- Test "Generate Summary" button:
  - Click button
  - Verify summary generation starts
  - Verify loading indicator shows
  - Verify summary appears when ready

### Task 2.5: Submit Answers to Questions ✅ E2E Test Implemented

**Description:** Test submitting answers to generated questions.

**E2E Test:** Test 4 in `tests/e2e/dialogue.spec.ts`

**Steps:**
1. Start dialogue and wait for questions to be generated (see Task 2.4)
2. Select answers for all questions (if multiple choice)
3. Click "Submit Answers" button
4. Verify dialogue continues with answers

**Expected Outcomes:**
- Answers are submitted correctly
- Dialogue continues with answers integrated
- Round updated correctly with answers
- Answers stored in files

**Files to Check:**
- `src/components/dialogue/QuestionGenerator.tsx`
- `src/lib/socket/handlers.ts` (answer submission)

**Verification Steps:**
- Select answers for all questions
- Click "Submit Answers"
- Verify answers are sent via Socket.IO
- Verify dialogue continues with answers in context
- Verify round is updated with answers
- Check files to verify answers are stored

## Phase 3: Feature Testing

**Status:** Pending - Requires manual browser testing

### Task 3.1: File Upload (Images) ✅ E2E Test Implemented

**Description:** Test uploading and processing image files.

**E2E Test:** Test 8 in `tests/e2e/dialogue.spec.ts`

**Steps:**
1. Navigate to `http://localhost:3000`
2. Enter a topic in the textarea
3. Click "Upload Images or PDFs" button
4. Select 1-5 valid image files (JPG, PNG)
5. Verify files validate correctly
6. Check file encoding progress indicator
7. Start dialogue with files attached

**Expected Outcomes:**
- Files validate correctly (correct type, size)
- File encoding progress indicator shows
- Files are encoded successfully
- Files sent in Socket.IO events
- AI responses reference uploaded files
- File data included in dialogue context

**Files to Verify:**
- `src/components/dialogue/InputSection.tsx`
- `public/workers/file-encoder.worker.js`

**Verification Steps:**
- Upload 1-5 image files (JPG, PNG)
- Verify validation messages (if any)
- Watch encoding progress indicator
- Verify files are encoded (check Network tab)
- Start dialogue
- Verify files are sent in Socket.IO `start-discussion` event
- Verify AI responses mention or reference the files
- Check file data in Socket.IO messages

### Task 3.2: File Upload (PDFs)

**Description:** Test uploading and processing PDF files.

**Note:** PDF extraction code exists (`src/lib/pdf-extraction.ts`) but E2E test not yet implemented. Manual testing required.

**Steps:**
1. Navigate to `http://localhost:3000`
2. Enter a topic in the textarea
3. Click "Upload Images or PDFs" button
4. Select a PDF file
5. Verify PDF processing/encoding
6. Start dialogue with PDF attached
7. Verify PDF content is included in dialogue

**Expected Outcomes:**
- PDF file validates correctly
- PDF processing/encoding works
- PDF text extraction works
- PDF content included in dialogue context
- AI responses reference PDF content

**Files to Check:**
- `src/lib/pdf-extraction.ts`
- `src/lib/socket/handlers.ts` (PDF handling)

**Verification Steps:**
- Upload a PDF file
- Verify PDF is accepted (not rejected)
- Watch for processing indicator
- Verify PDF text extraction works
- Start dialogue
- Verify PDF content is sent to server
- Verify AI responses reference PDF content
- Check extracted text in Socket.IO messages

### Task 3.3: User Input During Discussion

**Description:** Test adding user input during an ongoing discussion.

**Steps:**
1. Start a dialogue (see Task 2.2)
2. Let dialogue progress to first round
3. Click "User Input" button during discussion
4. Enter user input (10-1000 characters)
5. Submit user input
6. Verify user input is integrated into discussion

**Expected Outcomes:**
- User input button appears during discussion
- User input modal opens
- User can enter input (10-1000 characters)
- User input is submitted correctly
- User input is integrated into discussion
- Dialogue continues with user input

**Files to Verify:**
- `src/components/dialogue/UserInputModal.tsx`
- `src/components/dialogue/UserInput.tsx`

**Verification Steps:**
- Click "User Input" button
- Verify modal opens
- Enter valid input (10-1000 characters)
- Click "Submit" or "Send"
- Verify input is sent via Socket.IO
- Verify input appears in dialogue
- Verify dialogue continues with input in context

### Task 3.4: Resolution Detection

**Description:** Test automatic resolution detection when AIs reach a solution.

**Note:** Resolution detection code exists (`src/lib/llm/resolver.ts`) and ResolutionBanner component exists (`src/lib/components/dialogue/ResolutionBanner.tsx`) but E2E test not yet implemented. Manual testing required.

**Steps:**
1. Start a dialogue with a clear problem to solve
2. Let dialogue progress multiple rounds (4+ messages)
3. Wait for resolution detection algorithm to trigger
4. Verify resolution banner appears
5. Check that dialogue stops correctly

**Expected Outcomes:**
- Resolution banner appears when solution is reached
- Dialogue stops correctly
- `is_resolved` flag is set in database
- Resolution event is emitted
- UI indicates discussion is resolved

**Files to Check:**
- `src/components/dialogue/ResolutionBanner.tsx`
- `src/lib/llm/resolver.ts`

**Verification Steps:**
- Let dialogue progress with a solvable problem
- Wait for at least 4 messages (2 rounds)
- Verify resolution detection triggers
- Verify resolution banner appears
- Verify dialogue stops (no new rounds)
- Check database `is_resolved` flag
- Verify `conversation-resolved` event is emitted
- Verify UI shows resolved state

### Task 3.5: State Persistence on Refresh ✅ E2E Test Implemented

### Task 3.6: Reset Functionality ✅ E2E Test Implemented

**Description:** Test resetting dialogue state to start a new discussion.

**Steps:**
1. Start a dialogue (see Task 2.2)
2. Let dialogue progress 2-3 rounds
3. Click "Reset" button (if available) or start new dialogue
4. Verify previous state is cleared
5. Verify new dialogue can start cleanly

**Expected Outcomes:**
- Reset button appears (if implemented)
- Previous state is cleared
- Input section is reset
- New dialogue can start cleanly
- No errors in console

**Files to Check:**
- `src/components/dialogue/DialogueHero.tsx` (reset function)
- `src/lib/socket/client.ts` (state clearing)

**Verification Steps:**
- Start dialogue and let it progress
- Click reset button or start new dialogue
- Verify state was cleared (input enabled/visible)
- Verify no errors in console
- Verify can start new dialogue

**E2E Test:** Test 20 in `tests/e2e/dialogue.spec.ts`

**Description:** Test that discussion state is restored after page refresh.

**E2E Test:** Test 7 in `tests/e2e/dialogue.spec.ts`

**Steps:**
1. Start a dialogue (see Task 2.2)
2. Let dialogue progress 2-3 rounds
3. Note the discussion ID and current state
4. Refresh the page (F5 or Ctrl+R)
5. Verify state is restored from localStorage
6. Verify discussion continues correctly

**Expected Outcomes:**
- State is restored from localStorage on refresh
- Discussion continues from where it left off
- Rounds are displayed correctly
- No data loss occurs
- Socket.IO reconnects and restores state

**Files to Verify:**
- `src/lib/socket/client.ts` (localStorage persistence)
- `src/components/dialogue/DialogueHero.tsx` (state restoration)

**Verification Steps:**
- Start dialogue and let it progress
- Note discussion ID, rounds, current round number
- Refresh page (F5)
- Verify page loads
- Verify discussion ID is restored
- Verify rounds are displayed correctly
- Verify Socket.IO reconnects
- Verify discussion can continue
- Check localStorage contains discussion state

## Phase 4: Error Handling & Edge Cases

**Status:** Pending - Requires manual browser testing

### Task 4.1: Validation Testing

**Description:** Test input validation for topics and files.

**Test Cases:**

#### 4.1.1: Topic Too Short ✅ E2E Test Implemented
**E2E Test:** Test 13 in `tests/e2e/dialogue.spec.ts`

**Steps:**
1. Navigate to `http://localhost:3000`
2. Enter a topic less than 10 characters (e.g., "Test")
3. Try to click "Start AI Dialogue"
4. Verify button is disabled

**Expected Outcomes:**
- Button is disabled
- Validation error message may appear (if implemented)
- Dialogue does not start

**Files to Check:**
- `src/components/dialogue/InputSection.tsx`
- `src/lib/validation.ts`

#### 4.1.2: Topic Too Long ✅ E2E Test Implemented
**E2E Test:** Test 14 in `tests/e2e/dialogue.spec.ts`

**Steps:**
1. Navigate to `http://localhost:3000`
2. Enter a topic greater than 1000 characters
3. Click "Start AI Dialogue"
4. Verify error message appears

**Expected Outcomes:**
- Validation error message appears
- Dialogue does not start
- Error message is clear and helpful

**Files to Check:**
- `src/components/dialogue/InputSection.tsx`
- `src/lib/validation.ts`

#### 4.1.3: Invalid File Types ✅ E2E Test Implemented
**E2E Test:** Test 15 in `tests/e2e/dialogue.spec.ts`

**Steps:**
1. Navigate to `http://localhost:3000`
2. Try to upload a file that is not an image or PDF (e.g., .txt, .docx)
3. Verify error message appears

**Expected Outcomes:**
- Validation error message appears
- File is rejected
- Error message indicates allowed file types

**Files to Check:**
- `src/components/dialogue/InputSection.tsx`
- `src/lib/validation.ts`

#### 4.1.4: File Too Large ✅ E2E Test Implemented
**E2E Test:** Test 16 in `tests/e2e/dialogue.spec.ts`

**Steps:**
1. Navigate to `http://localhost:3000`
2. Try to upload a file larger than 10MB
3. Verify error message appears

**Expected Outcomes:**
- Validation error message appears
- File is rejected
- Error message indicates maximum file size

**Files to Check:**
- `src/components/dialogue/InputSection.tsx`
- `src/lib/validation.ts`

#### 4.1.5: Empty Topic Submission
**Steps:**
1. Navigate to `http://localhost:3000`
2. Leave topic textarea empty or with only whitespace
3. Try to start dialogue
4. Verify validation prevents submission

**Expected Outcomes:**
- Button is disabled or validation prevents submission
- Clear error message if validation fails

**Files to Check:**
- `src/components/dialogue/InputSection.tsx`
- `src/lib/validation.ts`

### Task 4.2: Network Error Handling ✅ E2E Test Implemented

**Description:** Test error handling when network connection is lost.

**E2E Test:** Test 6 in `tests/e2e/dialogue.spec.ts`

**Steps:**
1. Start a dialogue (see Task 2.2)
2. Let dialogue progress to first round
3. Disconnect network (or stop the server)
4. Verify error message appears
5. Verify reconnection attempts are shown
6. Reconnect network (or restart server)
7. Verify reconnection succeeds
8. Verify state is preserved

**Expected Outcomes:**
- Error message appears when connection is lost
- Reconnection attempts are shown to user
- State is preserved during disconnection
- Reconnection succeeds when network returns
- Dialogue can continue after reconnection

**Files to Verify:**
- `src/lib/socket/client.ts` (error handling, reconnection)
- `src/components/dialogue/DialogueHero.tsx` (error display)

**Verification Steps:**
- Start dialogue
- Disconnect network (or stop server with `Ctrl+C`)
- Verify error message appears in UI
- Verify reconnection attempts are shown
- Check console for reconnection logs
- Reconnect network (or restart server)
- Verify reconnection succeeds
- Verify state is preserved (rounds still visible)
- Verify dialogue can continue

### Task 4.3: Error Boundaries

**Description:** Test React error boundaries catch and handle errors gracefully.

### Task 4.4: Rate Limit Testing

**Description:** Test rate limiting functionality when too many requests are made.

**Steps:**
1. Navigate to `http://localhost:3000`
2. Start multiple dialogues rapidly (10+ requests in 60 seconds)
3. Verify rate limit error appears
4. Verify requests are blocked after limit
5. Wait for rate limit window to reset (60 seconds)
6. Verify can make requests again after reset

**Expected Outcomes:**
- Rate limit error appears when limit exceeded
- Requests are blocked after rate limit
- Error message is clear and helpful
- Rate limit window resets correctly
- Can make requests again after reset

**Files to Check:**
- `src/lib/rate-limit.ts`
- `src/lib/socket/handlers.ts` (rate limit enforcement)

**Verification Steps:**
- Send > 10 requests in 60 seconds
- Verify rate limit error appears
- Verify requests are blocked
- Wait for window reset (60 seconds)
- Verify can make requests again

**Steps:**
1. Navigate to `http://localhost:3000`
2. Open browser console
3. If possible, trigger a React error (may require code manipulation)
4. Verify error boundary catches the error
5. Verify fallback UI displays

**Expected Outcomes:**
- Error boundary catches React errors
- Fallback UI displays instead of blank screen
- Error details logged to console
- User can recover or refresh

**Files to Check:**
- `src/components/ErrorBoundary.tsx`
- `src/app/layout.tsx` (error boundary setup)

**Verification Steps:**
- Navigate to application
- Check for any uncaught errors in console
- If an error occurs, verify error boundary activates
- Verify fallback UI displays
- Verify error details are in console
- Verify user can refresh to recover

## Phase 5: Authentication Testing (If Configured)

**Status:** Pending - Requires OAuth setup and manual testing

**Note:** These tasks are only required if OAuth authentication is configured. Check if OAuth credentials are set up in `.env.local` before testing.

### Task 5.1: Sign In Flow

**Description:** Test OAuth sign-in flow with Google or GitHub.

**Prerequisites:**
- OAuth credentials configured in `.env.local`:
  - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (for Google)
  - `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (for GitHub)
  - `NEXTAUTH_SECRET` set

**Steps:**
1. Navigate to `http://localhost:3000`
2. Look for "Sign In" button
3. Click "Sign In" button
4. Select OAuth provider (Google or GitHub)
5. Complete OAuth flow
6. Verify user is authenticated
7. Verify user ID is stored correctly

**Expected Outcomes:**
- Sign in button appears (if OAuth configured)
- OAuth flow works correctly
- User is authenticated successfully
- User ID is stored correctly
- User session persists

**Files to Verify:**
- `src/components/auth/LoginButton.tsx`
- `src/app/auth/signin/page.tsx`
- `src/lib/auth/config.ts`

**Verification Steps:**
- Click "Sign In" button
- Test Google OAuth flow (if configured):
  - Click "Sign in with Google"
  - Complete Google authentication
  - Verify redirect back to app
  - Verify user is authenticated
- Test GitHub OAuth flow (if configured):
  - Click "Sign in with GitHub"
  - Complete GitHub authentication
  - Verify redirect back to app
  - Verify user is authenticated
- Verify user ID is stored in session
- Verify user menu or profile displays

### Task 5.2: Authenticated Dialogue

**Description:** Test starting and managing dialogue while authenticated.

**Note:** E2E test not yet implemented (Test 2). Requires OAuth setup for automated testing. Manual testing required.

**Steps:**
1. Sign in (see Task 5.1)
2. Start a dialogue (see Task 2.2)
3. Verify discussion is created in database
4. Verify files are created for user
5. Check discussion appears in history (if history feature exists)
6. Verify user-specific data isolation

**Expected Outcomes:**
- Discussion created in database with user ID
- Files created for user in user-specific directory
- Discussion appears in user's history
- User data is isolated (other users can't see it)
- User-specific discussions load correctly

**Files to Check:**
- `src/lib/db/discussions.ts`
- `src/lib/socket/handlers.ts` (user-specific handling)

**Verification Steps:**
- Sign in with OAuth
- Start dialogue with a topic
- Verify discussion is created in database:
  - Check `discussions` table
  - Verify `user_id` matches authenticated user
- Verify files are created:
  - Check `data/discussions/{userId}/` directory
  - Verify JSON and MD files exist
- Test data isolation:
  - Sign in as different user
  - Verify previous user's discussions are not visible
- Test history (if implemented):
  - Verify discussion appears in history
  - Verify can load previous discussions

## Phase 9: Browser Compatibility, Responsive Design & Accessibility Testing

**Status:** Pending - Requires manual browser testing

### Task 9.1: Cross-Browser Testing

**Description:** Test application functionality across different browsers.

**Browsers to Test:**
- Chrome (latest stable)
- Firefox (latest stable)
- Safari (latest stable - macOS)
- Edge (latest stable)

**Steps for Each Browser:**
1. Install/update browser to latest stable version
2. Clear browser cache and localStorage
3. Navigate to `http://localhost:3000`
4. Run critical path tests (Phase 2, Tasks 2.1-2.5)
5. Document any browser-specific issues

**Expected Outcomes:**
- Application works in all major browsers
- UI renders correctly in all browsers
- Functionality works consistently
- No browser-specific bugs
- Socket.IO connections work in all browsers

**Test Areas:**
- Page load and rendering
- Socket.IO connection
- Starting dialogue
- AI streaming
- File uploads
- UI responsiveness
- Error handling

**Verification Steps:**
- Test in Chrome:
  - Complete all critical path tests
  - Document any issues
- Test in Firefox:
  - Complete all critical path tests
  - Document any issues
  - Compare with Chrome behavior
- Test in Safari (if on macOS):
  - Complete all critical path tests
  - Document any issues
  - Check for Safari-specific quirks
- Test in Edge:
  - Complete all critical path tests
  - Document any issues
- Document all browser-specific issues found

### Task 9.2: Responsive Design Testing

**Description:** Test application at different viewport sizes.

**Viewport Sizes to Test:**
- Mobile: 375x667 (iPhone SE), 390x844 (iPhone 12 Pro)
- Tablet: 768x1024 (iPad), 1024x768 (iPad Landscape)
- Desktop: 1920x1080 (Full HD), 2560x1440 (2K)

**Steps:**
1. Open Chrome DevTools
2. Enable responsive design mode (Ctrl+Shift+M)
3. Test each viewport size:
   - Set viewport to target size
   - Test critical path functionality
   - Verify UI adapts correctly
   - Check for layout issues
   - Verify all elements are accessible

**Expected Outcomes:**
- UI adapts correctly to all viewport sizes
- All elements remain accessible
- No horizontal scrolling on mobile
- Text remains readable at all sizes
- Buttons and inputs are appropriately sized
- Layout doesn't break at any size

**Test Areas:**
- Hero section layout
- Input section layout
- Dialogue rounds display
- Message bubbles
- Action buttons
- File upload interface
- Navigation elements

**Verification Steps:**
- Test mobile viewport (375x667):
  - Verify layout stacks vertically
  - Verify text is readable
  - Verify buttons are touch-friendly
  - Verify no horizontal scrolling
  - Test all functionality
- Test tablet viewport (768x1024):
  - Verify layout adapts appropriately
  - Verify elements are properly spaced
  - Test all functionality
- Test desktop viewport (1920x1080):
  - Verify layout is optimal
  - Verify no wasted space
  - Test all functionality
- Document any responsive design issues

### Task 9.3: Accessibility Testing

**Description:** Test application accessibility with keyboard navigation and screen readers.

**Test Areas:**

#### 9.3.1: Keyboard Navigation
**Steps:**
1. Navigate to `http://localhost:3000` without using mouse
2. Use Tab key to navigate through interactive elements
3. Use Enter/Space to activate buttons
4. Use arrow keys if applicable
5. Verify all functionality is accessible via keyboard

**Expected Outcomes:**
- All interactive elements are keyboard accessible
- Focus indicators are visible
- Tab order is logical
- All actions can be performed via keyboard
- No keyboard traps

**Verification Steps:**
- Tab through all interactive elements
- Verify focus indicators are visible
- Verify logical tab order
- Test starting dialogue with keyboard only
- Test submitting forms with keyboard only
- Test navigating dialogue rounds with keyboard
- Verify no keyboard traps

#### 9.3.2: Screen Reader Testing
**Steps:**
1. Enable screen reader (NVDA, JAWS, or VoiceOver)
2. Navigate through application
3. Verify all content is announced correctly
4. Verify form labels are announced
5. Verify button purposes are clear
6. Verify error messages are announced

**Expected Outcomes:**
- All content is announced by screen reader
- Form labels are properly associated
- Button purposes are clear
- Error messages are announced
- Navigation is logical

**Verification Steps:**
- Navigate through page with screen reader
- Verify headings are announced
- Verify form inputs have labels
- Verify buttons have clear labels
- Verify error messages are announced
- Test starting dialogue with screen reader
- Verify AI responses are announced

#### 9.3.3: ARIA Attributes and Semantic HTML
**Steps:**
1. Inspect HTML structure in DevTools
2. Verify proper semantic HTML elements
3. Verify ARIA attributes where needed
4. Verify color contrast meets WCAG standards

**Expected Outcomes:**
- Semantic HTML used correctly
- ARIA attributes present where needed
- Color contrast meets WCAG AA standards
- Form inputs have proper labels
- Buttons have proper roles

**Verification Steps:**
- Check HTML structure for semantic elements
- Verify ARIA attributes on interactive elements
- Test color contrast (use browser extension)
- Verify form inputs have `<label>` elements
- Verify buttons have proper roles
- Verify landmarks are used correctly

### Task 9.4: Performance Monitoring

### Task 9.5: Multiple Tabs Testing

**Description:** Test application behavior when opened in multiple browser tabs.

**Steps:**
1. Open application in two browser tabs
2. Start a dialogue in tab 1
3. Verify dialogue appears in tab 2
4. Verify tabs stay in sync
5. Test interactions in both tabs

**Expected Outcomes:**
- Dialogue appears in both tabs
- Tabs stay synchronized
- State updates reflect in both tabs
- No conflicts or race conditions
- Socket.IO connections work in both tabs

**Verification Steps:**
- Open application in two tabs
- Start dialogue in tab 1
- Verify dialogue appears in tab 2
- Verify tabs stay in sync
- Test interactions in both tabs
- Verify no conflicts

### Task 9.6: Long Conversation Testing

**Description:** Test application performance and stability during long conversations.

**Steps:**
1. Start a dialogue with a complex topic
2. Let dialogue progress 10+ rounds
3. Monitor performance metrics
4. Verify UI remains responsive
5. Check for memory leaks

**Expected Outcomes:**
- Performance remains good during long conversations
- UI remains responsive
- No memory leaks occur
- All rounds display correctly
- Application doesn't slow down

**Verification Steps:**
- Start dialogue with complex topic
- Let it progress 10+ rounds
- Monitor memory usage
- Verify UI responsiveness
- Check for performance degradation
- Verify all rounds display correctly

**Description:** Monitor application performance during browser testing.

**Metrics to Monitor:**
- Page load time
- Time to first interaction
- Memory usage
- Network requests
- Bundle size
- Rendering performance

**Steps:**
1. Open Chrome DevTools
2. Go to Performance tab
3. Start recording
4. Navigate to `http://localhost:3000`
5. Start a dialogue
6. Let dialogue progress several rounds
7. Stop recording
8. Analyze performance metrics

**Expected Outcomes:**
- Page loads within 3 seconds
- Time to first interaction is acceptable
- Memory usage remains stable (no leaks)
- Network requests are efficient
- Rendering is smooth (60fps)
- No excessive re-renders

**Verification Steps:**
- Monitor page load performance:
  - Check load time in Network tab
  - Verify resources load efficiently
  - Check for large bundles
- Monitor runtime performance:
  - Record performance during dialogue
  - Check for memory leaks
  - Verify rendering performance
  - Check for excessive re-renders
- Monitor network efficiency:
  - Check Socket.IO message sizes
  - Verify efficient data transfer
  - Check for redundant requests
- Document any performance issues

## Known Changes & Updates

### Change: LLM Response Order Updated (2024-12-XX)

**Change:** The dialogue round execution order is: Solver AI → Analyzer AI → Moderator AI.

**Impact:**
- Analyzer AI now responds first in each round
- Solver AI responds first, Analyzer AI responds second, Moderator AI responds third
- Round structure remains the same (both responses still present)
- All documentation has been updated to reflect this change

**Verification:**
- See Task 2.3 verification steps for checking the new order
- Verify that responses appear in order: Solver AI → Analyzer AI → Moderator AI in each round

## Known TODOs & Technical Debt

### TODO 1: Summary State Management

**Location:** `src/components/dialogue/DialogueHero.tsx:473`

**Issue:**
```typescript
summaries={[]} // TODO: Pass summaries from context when available
```

**Status:** Documented for future implementation

**Priority:** Medium

**Impact:**
- RoundAccordion component won't show summary indicators for previous rounds
- Minor UX impact - summaries exist but aren't visually indicated in the accordion

**Recommendation:**
Track all summaries in component state when they're created via socket events. This requires:
1. Listen for `summary-created` socket events
2. Store summaries in component state
3. Pass summaries array to RoundAccordion component
4. Update RoundAccordion to display summary indicators

**Files to Modify:**
- `src/components/dialogue/DialogueHero.tsx`
- `src/components/dialogue/RoundAccordion.tsx` (if needed)

**Estimated Effort:** Medium (requires state management refactoring)

## Manual Testing Execution Instructions

### Prerequisites

1. **Start Development Server:**
   ```bash
   npm run dev
   ```
   Server should start on `http://localhost:3000`

2. **Prepare Browser Environment:**
   - Open Chrome browser (latest stable version)
   - Open DevTools (F12 or Ctrl+Shift+I)
   - Open tabs: Console, Network, Application
   - Clear browser cache and localStorage

3. **Prepare Test Data:**
   - Sample topics (valid: 50-200 characters)
   - Test image files (JPG, PNG)
   - Test PDF files
   - Invalid test data (short topics, large files, wrong file types)

### Execution Flow

1. **Start with Phase 2 (Critical Path Testing):**
   - Complete all tasks in Phase 2
   - Document any issues found
   - Fix critical issues before proceeding

2. **Continue with Phase 3 (Feature Testing):**
   - Test all features systematically
   - Document any issues found
   - Verify fixes from Phase 2

3. **Proceed to Phase 4 (Error Handling):**
   - Test all error scenarios
   - Verify error messages are clear
   - Test recovery mechanisms

4. **Test Phase 5 (Authentication) if configured:**
   - Only if OAuth is set up
   - Test sign-in flow
   - Test authenticated dialogue

5. **Complete Phase 9 (Compatibility & Accessibility):**
   - Test in multiple browsers
   - Test responsive design
   - Test accessibility features
   - Monitor performance

### Documentation Requirements

For each task, document:

1. **Test Results:**
   - Pass/Fail status
   - Issues found (if any)
   - Screenshots if applicable

2. **Console Errors:**
   - Copy any console errors
   - Note browser and version
   - Include full error stack traces

3. **Network Issues:**
   - Failed requests
   - Slow requests
   - Socket.IO connection issues

4. **UI Issues:**
   - Layout problems
   - Styling issues
   - Responsive design issues

5. **Functional Issues:**
   - Features not working
   - Unexpected behavior
   - Data loss

### Testing Checklist Summary

**Critical Path Tests (Must Pass):**
- [ ] Task 2.1: Initial Page Load & Connection
- [ ] Task 2.2: Start Dialogue (No Authentication) ✅ E2E Test Implemented
- [ ] Task 2.3: AI Conversation Streaming ✅ E2E Test Implemented
- [ ] Task 2.4: Round Completion & Actions ✅ E2E Test Implemented
- [ ] Task 2.5: Submit Answers to Questions ✅ E2E Test Implemented

**Feature Tests:**
- [ ] Task 3.1: File Upload (Images) ✅ E2E Test Implemented
- [ ] Task 3.2: File Upload (PDFs) (Code exists, E2E test needed)
- [ ] Task 3.3: User Input During Discussion
- [ ] Task 3.4: Resolution Detection (Code exists, E2E test needed)
- [ ] Task 3.5: State Persistence on Refresh ✅ E2E Test Implemented
- [ ] Task 3.6: Reset Functionality ✅ E2E Test Implemented

**Error Handling Tests:**
- [ ] Task 4.1: Validation Testing (all sub-tasks) ✅ E2E Tests Implemented
  - [ ] Task 4.1.1: Topic Too Short ✅ E2E Test Implemented
  - [ ] Task 4.1.2: Topic Too Long ✅ E2E Test Implemented
  - [ ] Task 4.1.3: Invalid File Types ✅ E2E Test Implemented
  - [ ] Task 4.1.4: File Too Large ✅ E2E Test Implemented
  - [ ] Task 4.1.5: Empty Topic Submission
- [ ] Task 4.2: Network Error Handling ✅ E2E Test Implemented
- [ ] Task 4.3: Error Boundaries
- [ ] Task 4.4: Rate Limit Testing

**Authentication Tests (if configured):**
- [ ] Task 5.1: Sign In Flow
- [ ] Task 5.2: Authenticated Dialogue (E2E test needed)

**Compatibility & Accessibility Tests:**
- [ ] Task 9.1: Cross-Browser Testing
- [ ] Task 9.2: Responsive Design Testing
- [ ] Task 9.3: Accessibility Testing (all sub-tasks)
- [ ] Task 9.4: Performance Monitoring
- [ ] Task 9.5: Multiple Tabs Testing
- [ ] Task 9.6: Long Conversation Testing

## E2E Test Coverage

**Automated E2E Tests Available:**
- E2E tests are implemented in `tests/e2e/dialogue.spec.ts` using Playwright
- Run E2E tests with: `npm run test:e2e` or `npm run test:e2e:ui`
- E2E tests cover many critical path and feature tests but do NOT replace manual browser testing
- Tasks marked with "✅ E2E Test Implemented" have automated tests but still require manual verification

**E2E Test Status:**
- ✅ Test 1: Start Dialogue (No Auth) → Task 2.2
- ✅ Test 3: AI Conversation Streaming → Task 2.3
- ✅ Test 4: Submit Answers to Questions → Task 2.5
- ✅ Test 6: Error Handling & Recovery → Task 4.2
- ✅ Test 7: State Persistence on Refresh → Task 3.5
- ✅ Test 8: File Upload (Images) → Task 3.1
- ✅ Test 10: Generate Summary → Task 2.4
- ✅ Test 11: Generate Questions → Task 2.4
- ✅ Test 12: Proceed Dialogue → Task 2.4
- ✅ Test 13: Invalid Topic (Too Short) → Task 4.1.1
- ✅ Test 14: Invalid Topic (Too Long) → Task 4.1.2
- ✅ Test 15: Invalid Files (Wrong Type) → Task 4.1.3
- ✅ Test 16: Invalid Files (Too Large) → Task 4.1.4
- ✅ Test 20: Reset Functionality → Task 3.6

**Missing E2E Tests (Code exists, manual testing required):**
- ⚠️ Test 2: Start Dialogue (With Auth) → Task 5.2 (requires OAuth setup)
- ⚠️ Test 5: Resolution Detection → Task 3.4 (code exists: `src/lib/llm/resolver.ts`, `src/lib/components/dialogue/ResolutionBanner.tsx`)
- ⚠️ Test 9: File Upload (PDFs) → Task 3.2 (code exists: `src/lib/pdf-extraction.ts`)
- ⚠️ Test 17: Rate Limit → Task 4.4
- ⚠️ Test 18: Multiple Tabs → Task 9.5
- ⚠️ Test 19: Long Conversation → Task 9.6

## Notes

- This task list contains ONLY pending/in-progress tasks
- All completed phases (1, 6, 7, 8, 10, 11) have been excluded
- Automated E2E tests are available for many scenarios (run with `npm run test:e2e`)
- E2E tests complement but do NOT replace manual browser testing
- This list focuses on manual browser testing requirements
- Update this document as tasks are completed
- Refer to source files for detailed context:
  - `IMPLEMENTATION_STATUS.md` - Overall status
  - `TESTING_SUMMARY.md` - Testing summary
  - `CODE_QUALITY_REVIEW.md` - Code quality details
  - `CHANGELOG.md` - Change history

## Quick Reference Commands

### Running Tests
```bash
npm run test:e2e      # Run E2E tests (automated browser testing)
npm run test:e2e:ui   # Run E2E tests with UI (interactive mode)
npm test              # Run unit tests
npm run lint          # Run linter
npm run type-check    # Type checking
```

**Note:** E2E tests cover many scenarios but manual browser testing is still required for:
- Visual verification and UI polish
- Cross-browser compatibility
- Accessibility testing
- Performance monitoring
- Edge cases and error scenarios not covered by E2E tests

### Server Management
```bash
npm run dev           # Start development server
npm run build         # Production build
npm start             # Start production server
```

### Browser Testing Setup
1. Start server: `npm run dev`
2. Open browser: Navigate to `http://localhost:3000`
3. Open DevTools: F12 or Ctrl+Shift+I
4. Clear storage: Application tab > Clear site data
5. Begin testing: Follow task list above
