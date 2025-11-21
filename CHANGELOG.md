# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Summaries State Management** - Fixed summaries array tracking in `useSocket` hook. Now properly tracks all summaries from `summary-created` events and passes them to `RoundAccordion` component. Previously only `currentSummary` was tracked
- **ErrorBoundary Theme** - Updated ErrorBoundary error display to match app theme (black background, green borders) instead of gray/blue theme
- **TypeScript Type Warnings** - Fixed unused import warnings in test files

### Added
- **Button Component Tests** - Added comprehensive integration tests for all button components:
  - `ActionButtons` component with handler verification and loading state tests
  - `InputSection` component with Start button and file upload tests
  - `QuestionGenerator` component with form submission and validation tests
  - `UserInputModal` component with validation and keyboard shortcut tests
  - `RoundAccordion` component with expand/collapse and copy functionality tests
- **Summaries Array State** - Added `summaries: SummaryEntry[]` state to `useSocket` hook to track all summaries created during a discussion
- **LocalStorage Persistence** - Updated localStorage persistence to include summaries array for state restoration

### Changed
- **Major Restructure: 3-Way Discussion System** - Restructured discussion system from 2-AI (Solver + Analyzer) to 3-way format (Solver → Analyzer → Moderator). Each round now includes responses from all three AIs in sequence, creating richer multi-perspective conversations
- **Moderator AI Role Change** - Moderator AI now participates directly in discussions as a third AI, guiding, clarifying, and synthesizing ideas, instead of generating separate summaries after each round
- **UI Layout Update** - Updated round display to show all three AI responses in a 3-column grid (Analyzer on left, Solver in middle, Moderator on right)
- **Response Order** - Updated dialogue round execution order to: Solver → Analyzer → Moderator. Turn numbers are now calculated as `(roundNumber - 1) * 3 + {1, 2, 3}` for each AI respectively
- Improved error logging in `RoundAccordion.tsx` - replaced `console.error` with structured `clientLogger.error()`
- Improved debug logging in `InputSection.tsx` - replaced `console.debug` calls with structured `clientLogger.debug()` calls
- Enhanced error context in clipboard copy functionality to include round number

### Removed
- **Removed Async Moderator Summaries** - Removed asynchronous moderator summary generation system. The `moderator-summary-created` and `moderator-summary-error` events no longer exist. The `ModeratorSummary` type has been removed from the codebase
- **Deleted Unused Code** - Removed `src/lib/llm/moderator.ts` file which contained the now-unused moderator summary generation function

### Fixed
- **Fixed Action Buttons Visibility** - Fixed issue where action buttons would disappear after clicking "Proceed". Buttons now correctly appear after each round completes
- **Fixed Position Swap** - Swapped Solver AI to right position and Analyzer AI to left position in round display as intended
- Fixed console statement usage in components to use proper client logger
- Improved error handling consistency across dialogue components
- **Critical Fix:** Fixed syntax error in `src/lib/socket/handlers.ts` - removed duplicate error handling code that was preventing server from starting (lines 1516-1544)
- **Critical Fix:** Fixed try-catch structure in `src/lib/socket/handlers.ts` - added missing catch block for outer try block and properly indented code inside try block
- Fixed TypeScript type errors in test fixtures - added `moderatorResponse` to `DiscussionRound` mock objects
- Fixed linting error in removed `moderator.ts` file

### Added
- Created comprehensive testing summary document (`TESTING_SUMMARY.md`)
- Added CHANGELOG.md for tracking changes
- Added `moderatorResponse` field to `DiscussionRound` type definition
- Updated `ConversationMessage` type to include `'Moderator AI'` as a valid persona
- Added moderator response to conversation context formatting and token counting

### Documentation
- Updated `README.md` to reflect 3-way discussion structure and new Moderator AI role
- Updated `docs/ARCHITECTURE.md` to reflect three AI personas instead of two
- Updated `docs/SOCKET_EVENTS.md` to remove `moderator-summary-created` event and update event flow diagrams to show 3 responses
- Updated all documentation to reflect new 3-way discussion structure:
  - Event flow diagrams now show Solver → Analyzer → Moderator sequence
  - Updated persona descriptions and system prompts
  - Updated round completion descriptions
- Created `TESTING_SUMMARY.md` documenting code quality review findings
- Updated documentation to reflect code quality improvements
- Documented known TODO items for future improvements

### Technical Debt
- Identified TODO in `DialogueHero.tsx` (line 473) regarding summaries array - requires state management changes to track all summaries

## [Previous Versions]

(Changelog started on 2024-12-XX)
