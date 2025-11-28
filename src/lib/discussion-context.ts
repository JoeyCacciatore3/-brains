import type { ConversationMessage, DiscussionRound, SummaryEntry } from '@/types';
import type { FileData } from '@/lib/validation';
import { readDiscussion } from '@/lib/discussions/file-manager';
import { calculateDiscussionTokenCount } from '@/lib/discussions/token-counter';
import { logger } from '@/lib/logger';
import { validateTokenCountSync } from '@/lib/discussions/reconciliation';
import {
  filterCompleteRounds,
  isRoundComplete,
  isRoundIncomplete,
  sortRoundsByRoundNumber,
  calculateTurnNumber,
} from '@/lib/discussions/round-utils';

/**
 * Load discussion context from file
 * Enhanced to support round-based structure with summaries
 *
 * IMPORTANT: Rounds are the primary source of truth.
 * Messages array is generated on-demand from rounds for backward compatibility only.
 */
export async function loadDiscussionContext(
  discussionId: string,
  userId: string
): Promise<{
  topic: string;
  messages: ConversationMessage[]; // Legacy: kept for backward compatibility
  rounds: DiscussionRound[]; // New: round-based structure - ALL rounds from JSON file
  summary?: string; // Legacy: kept for backward compatibility
  currentSummary?: SummaryEntry; // New: most recent summary with metadata
  summaries: SummaryEntry[]; // New: all summaries
  tokenCount: number; // New: calculated token count for context
}> {
  // CRITICAL: Load ALL rounds from JSON file (source of truth for full discussion history)
  // The JSON file contains the complete discussion history - all rounds are saved here
  const discussionData = await readDiscussion(discussionId, userId);

  // CRITICAL: Verify all rounds are loaded from JSON file
  const allRoundsCount = discussionData.rounds?.length || 0;
  if (allRoundsCount > 0) {
    logger.info('📚 Loaded all rounds from JSON file for LLM context', {
      discussionId,
      userId,
      totalRoundsInFile: allRoundsCount,
      roundNumbers: discussionData.rounds?.map((r) => r.roundNumber) || [],
      hasSummary: !!discussionData.currentSummary,
      summaryRound: discussionData.currentSummary?.roundNumber,
      roundsAfterSummary: discussionData.currentSummary
        ? discussionData.rounds?.filter((r) => r.roundNumber > discussionData.currentSummary!.roundNumber).length || 0
        : allRoundsCount,
      note: 'JSON file contains full discussion history - all rounds are available for LLM context',
    });
  }

  // Calculate token count for context using centralized function
  // This includes system prompts and formatting overhead (Option A: full context size)
  const tokenCount = calculateDiscussionTokenCount(discussionData, {
    includeSystemPrompts: true,
    includeFormattingOverhead: true,
  });

  // Generate messages array on-demand from rounds for LLM prompt formatting
  // Rounds are the primary source of truth. Messages array is derived, not stored.
  // CRITICAL: Only include complete rounds (all 3 responses) to prevent incorrect context
  // Incomplete rounds should be handled separately in formatLLMPrompt based on who is responding
  let messages: ConversationMessage[] = [];
  if (discussionData.rounds && discussionData.rounds.length > 0) {
    // CRITICAL: Sort rounds by roundNumber to ensure consistent order
    const sortedRounds = sortRoundsByRoundNumber(discussionData.rounds);

    // Filter to only complete rounds (all 3 responses have content)
    // This ensures messages array doesn't include partial rounds that could confuse context
    const completeRounds = filterCompleteRounds(sortedRounds);

    // Convert complete rounds to messages array on-demand for LLM context
    // Order: Analyzer -> Solver -> Moderator
    messages = completeRounds.flatMap((round) => {
      const msgs: ConversationMessage[] = [];
      if (round.analyzerResponse.content) {
        msgs.push(round.analyzerResponse);
      }
      if (round.solverResponse.content) {
        msgs.push(round.solverResponse);
      }
      if (round.moderatorResponse.content) {
        msgs.push(round.moderatorResponse);
      }
      return msgs;
    });

    // Add user messages if they exist (from legacy data or separate storage)
    // Use round number and turn number for proper ordering
    if (discussionData.messages && discussionData.messages.length > 0) {
      // User messages are separate from rounds, add them in chronological order
      // Sort by created_at, but also consider turn number for proper ordering
      const userMessages = discussionData.messages.map((msg) => ({
        ...msg,
        sortKey: msg.turn || msg.created_at, // Use turn number if available, else timestamp
      }));
      userMessages.sort((a, b) => a.sortKey - b.sortKey);

      // CRITICAL: Validate user message turn numbers don't conflict with round turn numbers
      // Round turn numbers follow pattern: (roundNumber - 1) * 3 + position (1, 2, or 3)
      // User messages should have unique turn numbers that don't overlap
      const roundTurnNumbers = new Set<number>();
      completeRounds.forEach((round) => {
        if (round.analyzerResponse?.turn) roundTurnNumbers.add(round.analyzerResponse.turn);
        if (round.solverResponse?.turn) roundTurnNumbers.add(round.solverResponse.turn);
        if (round.moderatorResponse?.turn) roundTurnNumbers.add(round.moderatorResponse.turn);
      });

      const conflictingTurns = userMessages.filter((msg) => msg.turn && roundTurnNumbers.has(msg.turn));
      if (conflictingTurns.length > 0) {
        logger.warn('User message turn numbers conflict with round turn numbers', {
          discussionId: discussionData.id,
          conflictingTurns: conflictingTurns.map((msg) => ({
            messageId: msg.id,
            turn: msg.turn,
            persona: msg.persona,
          })),
        });
      }

      // Validate user message turn numbers are unique
      const userTurnNumbers = userMessages.filter((msg) => msg.turn).map((msg) => msg.turn!);
      const duplicateTurns = userTurnNumbers.filter((turn, index) => userTurnNumbers.indexOf(turn) !== index);
      if (duplicateTurns.length > 0) {
        logger.warn('Duplicate user message turn numbers found', {
          discussionId: discussionData.id,
          duplicateTurns: [...new Set(duplicateTurns)],
        });
      }

      messages.push(...userMessages);
    }

    // Final sort by created_at to ensure proper chronological order
    messages.sort((a, b) => {
      // Primary sort: created_at
      if (a.created_at !== b.created_at) {
        return a.created_at - b.created_at;
      }
      // Secondary sort: turn number if available
      if (a.turn !== undefined && b.turn !== undefined) {
        return a.turn - b.turn;
      }
      return 0;
    });
  } else if (discussionData.messages && discussionData.messages.length > 0) {
    // Fallback: use legacy messages array if rounds don't exist (for old data only)
    messages = discussionData.messages;
  }

  // Optional: Validate token count sync (can be enabled via environment variable)
  // This helps detect file-database inconsistencies early
  if (process.env.ENABLE_TOKEN_SYNC_VALIDATION === 'true') {
    try {
      const syncResult = await validateTokenCountSync(discussionId, userId, {
        autoRepair: process.env.AUTO_REPAIR_TOKEN_SYNC === 'true',
        tolerancePercent: 5,
      });

      if (!syncResult.inSync) {
        logger.warn('Token count sync mismatch detected in loadDiscussionContext', {
          discussionId,
          userId,
          fileTokenCount: syncResult.fileTokenCount,
          dbTokenCount: syncResult.dbTokenCount,
          difference: syncResult.difference,
          differencePercent: syncResult.differencePercent,
          repaired: syncResult.repaired,
        });
      }
    } catch (error) {
      // Don't fail context loading if validation fails - just log it
      logger.warn('Token count sync validation failed', {
        discussionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // CRITICAL: Return ALL rounds from JSON file
  // The rounds array contains the complete discussion history from the JSON file
  // This is the source of truth - all rounds are saved here and available for LLM context
  const allRounds = discussionData.rounds || [];

  logger.info('✅ Discussion context loaded with all rounds from JSON file', {
    discussionId,
    userId,
    totalRounds: allRounds.length,
    roundNumbers: allRounds.map((r) => r.roundNumber),
    hasSummary: !!discussionData.currentSummary,
    summaryRound: discussionData.currentSummary?.roundNumber,
    tokenCount,
    note: 'All rounds from JSON file are available for LLM context. Summary (if exists) represents old rounds.',
  });

  return {
    topic: discussionData.topic,
    messages, // Generated on-demand from rounds (for LLM context formatting)
    rounds: allRounds, // ALL rounds from JSON file - primary source of truth for full discussion history
    summary: discussionData.summary, // Legacy
    currentSummary: discussionData.currentSummary, // New
    summaries: discussionData.summaries || [], // New
    tokenCount, // New
  };
}

/**
 * Format summary context section for prompts
 */
function formatSummaryContext(
  summaries?: SummaryEntry[],
  currentSummary?: SummaryEntry,
  legacySummary?: string
): string {
  // CRITICAL: Include all summaries in chronological order
  // If currentSummary exists, it should be in the summaries array, so we need to avoid duplication
  // We'll include all summaries from the array, and only add currentSummary separately if it's not in the array
  const summariesToInclude = summaries && summaries.length > 0
    ? summaries.sort((a, b) => a.roundNumber - b.roundNumber)
    : [];

  // Check if currentSummary is already in the summaries array (it should be)
  const currentSummaryInArray = currentSummary && summariesToInclude.some(
    (s) => s.roundNumber === currentSummary.roundNumber && s.summary === currentSummary.summary
  );

  // Include all summaries from the array
  const allSummariesSection = summariesToInclude.length > 0
    ? `\n\n## Discussion History (Summarized)\n${summariesToInclude
        .map(
          (s, idx) =>
            `### Summary ${idx + 1} (Round ${s.roundNumber})\n` +
            `Replaces rounds: ${s.replacesRounds.join(', ')}\n` +
            `${s.summary}`
        )
        .join('\n\n---\n\n')}\n\n---\n`
    : '';

  // Only include currentSummary separately if it's NOT already in the summaries array
  // This prevents duplication while handling edge cases where currentSummary might not be in the array
  const summaryToUse = currentSummary && !currentSummaryInArray
    ? currentSummary.summary
    : legacySummary;
  const summarySection = summaryToUse
    ? `\n\n## Discussion Summary (for context)\n${summaryToUse}\n\n---\n`
    : '';

  return allSummariesSection + summarySection;
}

/**
 * Format file information section for prompts
 */
function formatFileInfo(files?: FileData[]): string {
  return files && files.length > 0
    ? `\n\nAdditional context provided:\n${files
        .map(
          (file, idx) =>
            `- File ${idx + 1}: ${file.name} (${file.type}, ${(file.size / 1024).toFixed(1)}KB)`
        )
        .join('\n')}`
    : '';
}

/**
 * Format user answers section for prompts
 */
function formatUserAnswersSection(
  userAnswers?: Record<string, string[]>,
  _rounds?: DiscussionRound[]
): string {
  if (!userAnswers || Object.keys(userAnswers).length === 0) {
    return '';
  }

  return `\n\n## User Input from Previous Questions\n${Object.entries(userAnswers)
    .map(([_questionId, selectedOptions]) => {
      return `- Selected: ${selectedOptions.join(', ')}`;
    })
    .join('\n')}\n\n---\n`;
}

/**
 * Format round transcript from completed and incomplete rounds
 * CRITICAL: This formats ALL previous rounds for LLM context
 * - completedRounds: All complete rounds from previous rounds (from JSON file)
 * - incompleteRound: Current round being processed (if any)
 * The JSON file contains the complete discussion history - all rounds are included here
 */
function formatRoundTranscript(
  completedRounds: DiscussionRound[],
  incompleteRound?: DiscussionRound
): string {
  let transcript = '';

  // Format ALL completed rounds from JSON file
  // These represent the full discussion history available to LLMs
  if (completedRounds.length > 0) {
    transcript = completedRounds
      .map((round) => {
        // Include all three AI responses in each round for full context
        return `[Round ${round.roundNumber}]\n${round.analyzerResponse.persona}: ${round.analyzerResponse.content}\n\n${round.solverResponse.persona}: ${round.solverResponse.content}\n\n${round.moderatorResponse.persona}: ${round.moderatorResponse.content}`;
      })
      .join('\n\n---\n\n');
  }

  // If there's an incomplete round, add partial responses to transcript
  if (incompleteRound) {
    if (transcript) {
      transcript += '\n\n---\n\n';
    }
    transcript += `[Round ${incompleteRound.roundNumber}]\n${incompleteRound.analyzerResponse.persona}: ${incompleteRound.analyzerResponse.content}`;
    if (incompleteRound.solverResponse?.content) {
      transcript += `\n\n${incompleteRound.solverResponse.persona}: ${incompleteRound.solverResponse.content}`;
    }
    if (incompleteRound.moderatorResponse?.content) {
      transcript += `\n\n${incompleteRound.moderatorResponse.persona}: ${incompleteRound.moderatorResponse.content}`;
    }
  }

  return transcript;
}

/**
 * Format first message prompt for Analyzer starting Round 1
 */
function formatFirstMessagePrompt(
  topic: string,
  summaryContext: string,
  userAnswersSection: string,
  fileInfo: string
): string {
  return `You are starting a collaborative discussion about: "${topic}"${summaryContext}${userAnswersSection}${fileInfo}

Provide your initial analysis or approach to this topic (2-4 paragraphs). Set the stage for a productive back-and-forth conversation. Be engaging and thoughtful - you're starting a dialogue that will evolve through multiple exchanges.

IMPORTANT: Always complete your full thought within the token limit. Write comprehensive responses that fully develop your ideas. Ensure your response is complete and well-formed with proper punctuation and a complete thought. Do not leave sentences unfinished or thoughts incomplete.`;
}

/**
 * Format user input prompt when user has provided input
 */
function formatUserInputPrompt(
  topic: string,
  summaryContext: string,
  fileInfo: string,
  conversationTranscript: string,
  userMessage: ConversationMessage
): string {
  return `Topic: "${topic}"${summaryContext}${fileInfo}

Full conversation so far:

${conversationTranscript}

---

The user has provided the following input:

"${userMessage.content}"

Please respond to the user's input. Address their question or concern directly. If they're providing clarification or additional context, incorporate that into your response. Continue the collaborative dialogue by building on the conversation so far and the user's input. Reference specific points from the conversation and the user's message. Write 2-4 paragraphs that feel conversational and readable.`;
}

/**
 * Format new round prompt for Analyzer starting a new round
 */
function formatNewRoundPrompt(
  topic: string,
  summaryContext: string,
  fileInfo: string,
  conversationTranscript: string,
  currentRoundNumber: number,
  exchangeNumber: number,
  lastCompletedRoundNumber: number,
  otherPersona: 'Solver AI' | 'Analyzer AI' | 'Moderator AI',
  lastMessage: ConversationMessage
): string {
  return `Topic: "${topic}"${summaryContext}${fileInfo}

Full conversation so far:

${conversationTranscript}

---

You are now starting Round ${currentRoundNumber} of this discussion (Exchange ${exchangeNumber}). The previous round (Round ${lastCompletedRoundNumber}) concluded with ${otherPersona} saying:

"${lastMessage.content}"

Begin this new round by building on the discussion so far. Reference key points from previous rounds, introduce new perspectives, or deepen the analysis. This is a collaborative dialogue - engage thoughtfully with the conversation history while moving the discussion forward. Write 2-4 paragraphs that are comprehensive, well-developed, and contribute meaningfully to the dialogue. Always complete your full thought - ensure your response is complete and well-formed.`;
}

/**
 * Format continuation prompt for ongoing round responses
 */
function formatContinuationPrompt(
  topic: string,
  summaryContext: string,
  fileInfo: string,
  conversationTranscript: string,
  roundNum: number,
  exchangeNumber: number,
  otherPersona: 'Solver AI' | 'Analyzer AI' | 'Moderator AI',
  lastMessage: ConversationMessage
): string {
  return `Topic: "${topic}"${summaryContext}${fileInfo}

Full conversation so far:

${conversationTranscript}

---

You are now in Round ${roundNum}, Exchange ${exchangeNumber}. ${otherPersona} just said:

"${lastMessage.content}"

Respond directly to what they just said. Reference specific points they made. Build on their ideas, challenge assumptions constructively, ask clarifying questions, or add new perspectives. This is a real dialogue - make it feel like you're actively engaging with their thoughts, not just making isolated statements. Use natural transitions and references to create a flowing conversation. Write 2-4 paragraphs that are comprehensive, well-developed, and feel conversational and readable. Always complete your full thought - ensure your response is complete and well-formed within the token limit.`;
}

/**
 * Formats discussion context for LLM prompt
 * Returns the user message content that should be sent to the LLM
 * Enhanced to support round-based structure with summaries
 *
 * CRITICAL: The rounds parameter contains ALL rounds from the JSON file
 * - JSON file is the source of truth and contains the complete discussion history
 * - All previous rounds are included in the LLM context
 * - If summary exists, it represents old rounds and only rounds after summary are included
 * - If no summary, ALL rounds from JSON file are included
 *
 * @param respondingPersonaName - The name of the AI persona that will be responding ('Solver AI', 'Analyzer AI', or 'Moderator AI')
 * @param summary - Optional summary to include at the beginning for context (legacy)
 * @param rounds - ALL rounds from JSON file (complete discussion history)
 * @param currentSummary - Optional current summary entry with metadata (new)
 * @param userAnswers - Optional user answers to questions from previous rounds
 * @param currentRoundNumber - Optional current round number to help detect new round starts
 */
export function formatLLMPrompt(
  topic: string,
  conversationMessages: ConversationMessage[],
  isFirstMessage: boolean,
  respondingPersonaName: 'Solver AI' | 'Analyzer AI' | 'Moderator AI', // The AI persona that will be responding
  files?: FileData[],
  summary?: string, // Legacy
  rounds?: DiscussionRound[], // New
  currentSummary?: SummaryEntry, // New
  summaries?: SummaryEntry[], // New: all summaries in chronological order
  userAnswers?: Record<string, string[]>, // New: questionId -> selected option IDs
  currentRoundNumber?: number // New: current round number
): string {
  // Format sections using helper functions
  const fileInfo = formatFileInfo(files);
  const summaryContext = formatSummaryContext(summaries, currentSummary, summary);
  const userAnswersSection = formatUserAnswersSection(userAnswers, rounds);

  // Extract summary sections for use in prompts
  const summaryToUse = currentSummary?.summary || summary;

  // CRITICAL: If this is truly the first message, return immediately
  // Don't process any rounds or messages - Analyzer should start fresh
  if (isFirstMessage) {
    logger.info('formatLLMPrompt: First message detected - returning first message prompt', {
      respondingPersonaName,
      roundsCount: rounds?.length || 0,
      messagesCount: conversationMessages.length,
      currentRoundNumber,
    });
    return formatFirstMessagePrompt(topic, summaryContext, userAnswersSection, fileInfo);
  }

  // Use rounds if available (new structure), fallback to legacy messages
  let conversationTranscript = '';
  let lastMessage: ConversationMessage | null = null;
  let exchangeNumber = 1;
  let completedRounds: DiscussionRound[] = [];

  logger.info('formatLLMPrompt called', {
    respondingPersonaName,
    isFirstMessage,
    roundsCount: rounds?.length || 0,
    messagesCount: conversationMessages.length,
    hasSummary: !!summaryToUse,
    currentRoundNumber,
    roundsWithContent: rounds?.filter((r) =>
      (r.analyzerResponse?.content?.trim() || r.solverResponse?.content?.trim() || r.moderatorResponse?.content?.trim())
    ).length || 0,
    incompleteRoundsCount: rounds?.filter((r) =>
      r.analyzerResponse?.content && (!r.solverResponse?.content || !r.moderatorResponse?.content)
    ).length || 0,
    completedRoundsCount: rounds?.filter((r) =>
      r.analyzerResponse?.content && r.solverResponse?.content && r.moderatorResponse?.content
    ).length || 0,
  });

  if (rounds && rounds.length > 0) {
    // CRITICAL: Sort rounds by roundNumber to ensure consistent order
    const sortedRounds = sortRoundsByRoundNumber(rounds);

    // CRITICAL: Include ALL previous rounds in LLM context
    // - If summary exists: Summary represents old rounds, include summary + all rounds after summary
    // - If no summary: Include ALL rounds from JSON file
    // The JSON file is the source of truth and contains the complete discussion history
    let roundsToInclude = currentSummary
      ? sortedRounds.filter((r) => r.roundNumber > currentSummary.roundNumber) // Summary replaces old rounds, include rounds after summary
      : sortedRounds; // No summary: Include ALL rounds from JSON file (full history)

    logger.info('📖 Including rounds in LLM context', {
      respondingPersonaName,
      totalRoundsInFile: sortedRounds.length,
      roundsIncluded: roundsToInclude.length,
      hasSummary: !!currentSummary,
      summaryRound: currentSummary?.roundNumber,
      roundsAfterSummary: currentSummary
        ? sortedRounds.filter((r) => r.roundNumber > currentSummary.roundNumber).length
        : sortedRounds.length,
      includedRoundNumbers: roundsToInclude.map((r) => r.roundNumber),
      note: 'LLM context includes all available rounds from JSON file (summary replaces old rounds if exists)',
    });

    // ALL LLMs see ALL rounds - no filtering based on persona
    // Execution order (Analyzer → Solver → Moderator) is enforced separately
    // and does not affect what context each LLM can see

    // Check for incomplete round in current round
    // Incomplete round means: Some responses exist but not all three
    const incompleteRound = roundsToInclude.find(
      (r) => r.roundNumber === currentRoundNumber && isRoundIncomplete(r)
    );

    // Build transcript from completed rounds (all three AIs have responded)
    // Exclude incomplete round to prevent duplication
    completedRounds = roundsToInclude.filter(
      (r) => isRoundComplete(r) && (!incompleteRound || r.roundNumber !== incompleteRound.roundNumber)
    );

    // Format completed rounds
    if (completedRounds.length > 0) {
      // CRITICAL AUDIT: Log completed rounds order for Analyzer
      if (respondingPersonaName === 'Analyzer AI') {
        logger.info('🔍 AUDIT: Completed rounds being formatted for Analyzer', {
          currentRoundNumber,
          completedRoundsCount: completedRounds.length,
          completedRoundNumbers: completedRounds.map((r) => r.roundNumber),
          lastRoundPersonas: completedRounds.length > 0
            ? [
                completedRounds[completedRounds.length - 1].analyzerResponse.persona,
                completedRounds[completedRounds.length - 1].solverResponse.persona,
                completedRounds[completedRounds.length - 1].moderatorResponse.persona,
              ]
            : [],
          note: 'Analyzer should see rounds in order: Analyzer → Solver → Moderator',
        });
      }

      // Format completed rounds using helper function
      conversationTranscript = formatRoundTranscript(completedRounds, incompleteRound || undefined);
    } else if (incompleteRound) {
      // Only incomplete round, no completed rounds
      conversationTranscript = formatRoundTranscript([], incompleteRound || undefined);
    }

    // Determine last message and exchange number based on rounds structure
    // Order: Analyzer -> Solver -> Moderator
    // Exchange number calculation: (roundNumber - 1) * 3 + position
    // Position: 1 for Analyzer, 2 for Solver, 3 for Moderator

    // CRITICAL: Determine lastMessage based on who is responding
    if (respondingPersonaName === 'Analyzer AI') {
      // Analyzer is starting a new round
      // It should respond to Moderator from the previous round (or null for Round 1)

      // CRITICAL AUDIT: Verify no Solver responses in completedRounds for Analyzer
      const solverResponsesInCompleted = completedRounds.filter((r) =>
        r.solverResponse?.content?.trim() && (!r.moderatorResponse?.content?.trim() || !r.analyzerResponse?.content?.trim())
      );
      if (solverResponsesInCompleted.length > 0) {
        logger.error('🚨 CRITICAL BUG: Incomplete rounds with Solver responses in Analyzer context!', {
          currentRoundNumber,
          solverResponsesCount: solverResponsesInCompleted.length,
          solverResponseRounds: solverResponsesInCompleted.map((r) => ({
            roundNumber: r.roundNumber,
            hasAnalyzer: !!r.analyzerResponse?.content?.trim(),
            hasSolver: !!r.solverResponse?.content?.trim(),
            hasModerator: !!r.moderatorResponse?.content?.trim(),
          })),
          note: 'Analyzer should NEVER see Solver responses from incomplete rounds',
        });
      }

      if (completedRounds.length > 0) {
        const lastRound = completedRounds[completedRounds.length - 1];
        lastMessage = lastRound.moderatorResponse;

        // CRITICAL VALIDATION: Ensure Analyzer's lastMessage is Moderator, never Solver
        if (lastMessage.persona !== 'Moderator AI') {
          logger.error('🚨 CRITICAL BUG: Analyzer lastMessage is not Moderator!', {
            currentRoundNumber,
            lastCompletedRound: lastRound.roundNumber,
            expectedPersona: 'Moderator AI',
            actualPersona: lastMessage.persona,
            lastMessageTurn: lastMessage.turn,
            hasModerator: !!lastRound.moderatorResponse?.content?.trim(),
            hasSolver: !!lastRound.solverResponse?.content?.trim(),
            hasAnalyzer: !!lastRound.analyzerResponse?.content?.trim(),
            error: 'Analyzer must respond to Moderator from previous complete round, never to Solver',
          });
          // Force lastMessage to Moderator if it exists
          if (lastRound.moderatorResponse?.content?.trim()) {
            lastMessage = lastRound.moderatorResponse;
            logger.error('🔧 ROOT CAUSE FIX: Corrected Analyzer lastMessage to Moderator', {
              currentRoundNumber,
              lastCompletedRound: lastRound.roundNumber,
              correctedPersona: lastMessage.persona,
            });
          } else {
            // No Moderator response - this should never happen for a complete round
            logger.error('🚨 CRITICAL BUG: Complete round missing Moderator response!', {
              currentRoundNumber,
              lastCompletedRound: lastRound.roundNumber,
              hasModerator: !!lastRound.moderatorResponse?.content?.trim(),
              hasSolver: !!lastRound.solverResponse?.content?.trim(),
              hasAnalyzer: !!lastRound.analyzerResponse?.content?.trim(),
            });
            lastMessage = null;
          }
        }

        // CRITICAL AUDIT: Log what Analyzer is responding to
        logger.info('🔍 AUDIT: Analyzer lastMessage determination', {
          currentRoundNumber,
          lastCompletedRound: lastRound.roundNumber,
          lastMessagePersona: lastMessage?.persona,
          lastMessageTurn: lastMessage?.turn,
          lastMessagePreview: lastMessage?.content?.substring(0, 100),
          note: 'Analyzer should respond to Moderator from previous round, never to Solver',
          validated: lastMessage?.persona === 'Moderator AI' || lastMessage === null,
        });

        // CRITICAL FIX: Calculate target round correctly
        // If currentRoundNumber is provided, use it; otherwise, calculate next round
        // ROOT CAUSE FIX: Always prefer currentRoundNumber if provided - it's the source of truth
        const targetRound = currentRoundNumber !== undefined ? currentRoundNumber : lastRound.roundNumber + 1;

        // CRITICAL FIX: Log the calculation to debug exchange number issues
        logger.info('🔍 ROOT CAUSE: Calculating exchange number for Analyzer', {
          lastCompletedRound: lastRound.roundNumber,
          currentRoundNumber,
          targetRound,
          calculation: `calculateTurnNumber(${targetRound}, 'Analyzer AI')`,
          expectedFormula: `(${targetRound} - 1) * 3 + 1 = ${(targetRound - 1) * 3 + 1}`,
        });

        // CRITICAL FIX: Ensure exchange number is correct for Analyzer
        // Analyzer should ALWAYS be: Round 1 = Exchange 1, Round 2 = Exchange 4, Round 3 = Exchange 7, etc.
        exchangeNumber = calculateTurnNumber(targetRound, 'Analyzer AI');

        // CRITICAL FIX: Verify calculation is correct - this is the ROOT CAUSE check
        const expectedExchangeForRound = (targetRound - 1) * 3 + 1;
        if (exchangeNumber !== expectedExchangeForRound) {
          logger.error('🚨 ROOT CAUSE: Exchange number calculation error for Analyzer!', {
            targetRound,
            calculatedExchangeNumber: exchangeNumber,
            expectedExchangeNumber: expectedExchangeForRound,
            formula: `(roundNumber - 1) * 3 + 1 = (${targetRound} - 1) * 3 + 1 = ${expectedExchangeForRound}`,
            lastCompletedRound: lastRound.roundNumber,
            currentRoundNumber,
            note: 'This indicates calculateTurnNumber is returning wrong value or targetRound is wrong',
          });
          // ROOT CAUSE FIX: Use the formula directly instead of calculateTurnNumber
          exchangeNumber = expectedExchangeForRound;
          logger.error('🔧 ROOT CAUSE FIX: Forced exchange number to correct value', {
            correctedExchangeNumber: exchangeNumber,
            targetRound,
          });
        }

        logger.info('formatLLMPrompt: Analyzer starting new round - responding to Moderator from previous round', {
          lastCompletedRound: lastRound.roundNumber,
          targetRound,
          lastMessagePersona: lastMessage?.persona,
          exchangeNumber,
          expectedExchangeNumber: expectedExchangeForRound,
          verifiedCorrect: exchangeNumber === expectedExchangeForRound,
          respondingPersonaName,
        });
      } else {
        // Starting Round 1 with no previous rounds
        lastMessage = null;

        // CRITICAL FIX: Round 1 Analyzer should ALWAYS be Exchange 1
        const targetRoundForRound1 = currentRoundNumber !== undefined ? currentRoundNumber : 1;
        exchangeNumber = calculateTurnNumber(targetRoundForRound1, 'Analyzer AI');

        // CRITICAL FIX: Verify Round 1 Analyzer is Exchange 1
        if (exchangeNumber !== 1) {
          logger.error('🚨 CRITICAL: Round 1 Analyzer should be Exchange 1!', {
            currentRoundNumber,
            calculatedExchangeNumber: exchangeNumber,
            expectedExchangeNumber: 1,
          });
          exchangeNumber = 1; // Force to Exchange 1 for Round 1
        }

        logger.info('formatLLMPrompt: Analyzer starting Round 1 with no previous rounds', {
          currentRoundNumber,
          exchangeNumber,
          verifiedCorrect: exchangeNumber === 1,
          respondingPersonaName,
          lastMessage: null,
        });
      }
    } else if (incompleteRound) {
      // Solver or Moderator responding in current round
      // Determine which response we're waiting for
      if (respondingPersonaName === 'Solver AI' && !incompleteRound.solverResponse?.content) {
        // Solver responding to Analyzer in current round
        lastMessage = incompleteRound.analyzerResponse;
        exchangeNumber = calculateTurnNumber(incompleteRound.roundNumber, 'Solver AI');
        logger.debug('formatLLMPrompt: Solver responding to Analyzer in current round', {
          roundNumber: incompleteRound.roundNumber,
          lastMessagePersona: lastMessage.persona,
          exchangeNumber,
          respondingPersonaName,
        });
      } else if (respondingPersonaName === 'Moderator AI' && !incompleteRound.moderatorResponse?.content) {
        // Moderator responding to Solver in current round
        lastMessage = incompleteRound.solverResponse;
        exchangeNumber = calculateTurnNumber(incompleteRound.roundNumber, 'Moderator AI');
        logger.debug('formatLLMPrompt: Moderator responding to Solver in current round', {
          roundNumber: incompleteRound.roundNumber,
          lastMessagePersona: lastMessage.persona,
          exchangeNumber,
          respondingPersonaName,
        });
      } else {
        // Unexpected state - shouldn't happen
        logger.warn('formatLLMPrompt: Unexpected incomplete round state', {
          roundNumber: incompleteRound.roundNumber,
          respondingPersonaName,
          hasAnalyzer: !!incompleteRound.analyzerResponse?.content,
          hasSolver: !!incompleteRound.solverResponse?.content,
          hasModerator: !!incompleteRound.moderatorResponse?.content,
        });
        // Fallback: use last message from incomplete round
        if (incompleteRound.solverResponse?.content) {
          lastMessage = incompleteRound.solverResponse;
        } else if (incompleteRound.analyzerResponse?.content) {
          lastMessage = incompleteRound.analyzerResponse;
        }
        exchangeNumber = calculateTurnNumber(incompleteRound.roundNumber, respondingPersonaName);
      }
    } else if (completedRounds.length > 0) {
      // All rounds are complete, but we're not Analyzer starting a new round
      // This shouldn't happen in normal flow, but handle gracefully
      const lastRound = completedRounds[completedRounds.length - 1];
      lastMessage = lastRound.moderatorResponse;
      const targetRound = currentRoundNumber !== undefined ? currentRoundNumber : lastRound.roundNumber + 1;
      exchangeNumber = calculateTurnNumber(targetRound, respondingPersonaName);
      logger.warn('formatLLMPrompt: All rounds complete but not Analyzer - unexpected state', {
        lastCompletedRound: lastRound.roundNumber,
        targetRound,
        lastMessagePersona: lastMessage.persona,
        exchangeNumber,
        respondingPersonaName,
      });
    } else {
      // No rounds at all - shouldn't happen if we got here (isFirstMessage should have caught it)
      lastMessage = null;
      exchangeNumber = currentRoundNumber !== undefined ? calculateTurnNumber(currentRoundNumber, 'Analyzer AI') : 1;
      logger.warn('formatLLMPrompt: No rounds found - unexpected state', {
        currentRoundNumber,
        exchangeNumber,
        respondingPersonaName,
      });
    }

    // Include user answers in context with question context for clarity
    if (userAnswers && Object.keys(userAnswers).length > 0) {
      const answersText = Object.entries(userAnswers)
        .map(([questionId, selectedOptions]) => {
          // Find the question text from rounds
          let questionText = `Question ${questionId}`;
          if (roundsToInclude) {
            for (const round of roundsToInclude) {
              if (round.questions?.questions) {
                const question = round.questions.questions.find((q) => q.id === questionId);
                if (question) {
                  questionText = question.text;
                  break;
                }
              }
            }
          }
          return `Q: ${questionText}\nA: User selected: ${selectedOptions.join(', ')}`;
        })
        .join('\n\n');
      conversationTranscript += `\n\nUser Input:\n${answersText}`;
    }

  } else {
    // Legacy: format messages as conversation transcript
    conversationTranscript = conversationMessages
      .map((msg, idx) => {
        const exchangeNum = Math.floor(idx / 2) + 1;
        return `[Exchange ${exchangeNum}] ${msg.persona}: ${msg.content}`;
      })
      .join('\n\n');

    // Separate AI messages from user messages (for legacy support)
    const aiMessages = conversationMessages.filter((m) => m.persona !== 'User');
    lastMessage = conversationMessages[conversationMessages.length - 1] || null;
    exchangeNumber = Math.floor(aiMessages.length / 2) + 1;
  }

  // If the last message is from a user, the AI should respond to the user's input
  if (lastMessage && lastMessage.persona === 'User') {
    return formatUserInputPrompt(topic, summaryContext, fileInfo, conversationTranscript, lastMessage);
  }

  // Determine which AI should respond based on rounds or responding persona
  // Order: Analyzer -> Solver -> Moderator
  // CRITICAL: otherPersona is the persona whose message we're responding to
  let otherPersona: 'Solver AI' | 'Analyzer AI' | 'Moderator AI';

  if (lastMessage) {
    // otherPersona is simply the persona of the last message
    // This is who we're responding to
    if (lastMessage.persona === 'Analyzer AI') {
      otherPersona = 'Analyzer AI';
    } else if (lastMessage.persona === 'Solver AI') {
      otherPersona = 'Solver AI';
    } else if (lastMessage.persona === 'Moderator AI') {
      otherPersona = 'Moderator AI';
    } else {
      // Fallback for user messages or unknown personas
      otherPersona = 'Moderator AI'; // Default to Moderator
    }

    // CRITICAL CHECK: Analyzer should NEVER be told to respond to Solver
    // If this happens, it's a bug - log it and fix it
    if (respondingPersonaName === 'Analyzer AI' && otherPersona === 'Solver AI') {
      logger.error('🚨 CRITICAL BUG: Analyzer incorrectly told to respond to Solver!', {
        respondingPersonaName,
        otherPersona,
        lastMessagePersona: lastMessage?.persona,
        currentRoundNumber,
        roundsCount: rounds?.length || 0,
        completedRoundsCount: rounds?.filter((r) =>
          r.analyzerResponse?.content && r.solverResponse?.content && r.moderatorResponse?.content
        ).length || 0,
        lastMessageContent: lastMessage?.content?.substring(0, 100),
      });
      // Fix: Analyzer should respond to Moderator from previous round, or null for Round 1
      // CRITICAL: Use only complete rounds to find the last Moderator response
      if (rounds && rounds.length > 0) {
        const completedRounds = filterCompleteRounds(rounds);
        if (completedRounds.length > 0) {
          const lastRound = completedRounds[completedRounds.length - 1];
          lastMessage = lastRound.moderatorResponse;
          otherPersona = 'Moderator AI';
          logger.info('formatLLMPrompt: Fixed - Analyzer now responding to Moderator from previous complete round', {
            lastCompletedRound: lastRound.roundNumber,
            currentRoundNumber,
            moderatorContentLength: lastMessage?.content?.length || 0,
          });
        } else {
          // No completed rounds - this should be Round 1
          lastMessage = null;
          otherPersona = 'Moderator AI'; // Will be ignored since lastMessage is null
          logger.info('formatLLMPrompt: Fixed - Analyzer starting Round 1 with no previous rounds', {
            currentRoundNumber,
          });
        }
      } else {
        // No rounds at all - this is Round 1
        lastMessage = null;
        otherPersona = 'Moderator AI';
        logger.info('formatLLMPrompt: Fixed - Analyzer starting Round 1 with no rounds', {
          currentRoundNumber,
        });
      }

      // CRITICAL: Validate the fix worked
      if (lastMessage && lastMessage.persona !== 'Moderator AI') {
        logger.error('🚨 CRITICAL BUG: Fix failed - Analyzer still has wrong lastMessage persona!', {
          currentRoundNumber,
          lastMessagePersona: lastMessage.persona,
          expectedPersona: 'Moderator AI',
        });
        throw new Error('CRITICAL: Failed to fix Analyzer lastMessage - still not Moderator');
      }
    }

    // CRITICAL VALIDATION: Final check - Analyzer's otherPersona must be Moderator or null
    if (respondingPersonaName === 'Analyzer AI' && lastMessage && otherPersona !== 'Moderator AI') {
      logger.error('🚨 CRITICAL BUG: Analyzer otherPersona is not Moderator!', {
        respondingPersonaName,
        otherPersona,
        lastMessagePersona: lastMessage.persona,
        currentRoundNumber,
        error: 'Analyzer must respond to Moderator or null, never to Solver or Analyzer',
      });
      throw new Error(`CRITICAL: Analyzer otherPersona is ${otherPersona}, expected Moderator AI or null`);
    }
  } else {
    // No last message - this is Round 1, Analyzer starting fresh
    // otherPersona doesn't matter since we'll use first message prompt
    otherPersona = 'Moderator AI'; // Default, won't be used
  }

  // If we have a last message, use it; otherwise provide general context
  if (lastMessage) {
    logger.debug('formatLLMPrompt: Using last message context', {
      respondingPersonaName,
      lastMessagePersona: lastMessage.persona,
      otherPersona,
      exchangeNumber,
      lastMessageLength: lastMessage.content.length,
      currentRoundNumber,
    });

    // Determine if Analyzer is starting a new round (check if we have rounds context)
    // CRITICAL FIX: Use completedRounds calculated earlier (line 400) instead of recalculating
    // This ensures we're checking the same completed rounds that were used to set lastMessage
    let isAnalyzerStartingNewRound = false;
    let lastCompletedRoundNumber = 0;

    // CRITICAL FIX: Use completedRounds from earlier in the function (line 400)
    // This is the same completedRounds used to determine lastMessage, ensuring consistency
    if (completedRounds.length > 0) {
      lastCompletedRoundNumber = completedRounds[completedRounds.length - 1].roundNumber;
    }

    // CRITICAL FIX: Check if Analyzer is starting a new round
    // Conditions:
    // 1. Must be Analyzer AI
    // 2. Must have a lastMessage (from Moderator if starting new round, or null for Round 1)
    // 3. If lastMessage exists, it should be from Moderator (indicating previous round completed)
    // 4. Must have currentRoundNumber defined
    // 5. If we have completed rounds, currentRoundNumber should be > lastCompletedRoundNumber
    isAnalyzerStartingNewRound = respondingPersonaName === 'Analyzer AI' &&
      (lastMessage === null || lastMessage.persona === 'Moderator AI') &&
      currentRoundNumber !== undefined &&
      (completedRounds.length === 0 || currentRoundNumber > lastCompletedRoundNumber);

    // CRITICAL FIX: Log the decision for debugging
    logger.info('🔍 Checking if Analyzer is starting new round', {
      respondingPersonaName,
      isAnalyzerAI: respondingPersonaName === 'Analyzer AI',
      lastMessagePersona: lastMessage?.persona || 'null',
      lastMessageIsModerator: lastMessage?.persona === 'Moderator AI',
      completedRoundsCount: completedRounds.length,
      lastCompletedRoundNumber,
      currentRoundNumber,
      currentRoundGreaterThanLast: completedRounds.length > 0 ? currentRoundNumber! > lastCompletedRoundNumber : true,
      isAnalyzerStartingNewRound,
    });

    if (isAnalyzerStartingNewRound) {
      // Analyzer is starting a new round - provide context about the round
      // CRITICAL FIX: Recalculate exchange number from currentRoundNumber to ensure it's correct
      // Analyzer in Round N should be Exchange: (N-1)*3 + 1
      // Don't trust the exchangeNumber calculated earlier - recalculate from currentRoundNumber
      const correctExchangeNumber = calculateTurnNumber(currentRoundNumber!, 'Analyzer AI');
      const formulaResult = (currentRoundNumber! - 1) * 3 + 1;

      // CRITICAL FIX: Always use the correct exchange number calculated from currentRoundNumber
      if (exchangeNumber !== correctExchangeNumber || exchangeNumber !== formulaResult) {
        logger.error('🚨 CRITICAL: Exchange number was incorrect for Analyzer starting new round!', {
          currentRoundNumber,
          previousExchangeNumber: exchangeNumber,
          correctExchangeNumber,
          formulaResult,
          formula: `(roundNumber - 1) * 3 + 1 = (${currentRoundNumber} - 1) * 3 + 1 = ${formulaResult}`,
          lastCompletedRound: lastCompletedRoundNumber,
          respondingPersonaName,
        });
        // CRITICAL FIX: Use the correct exchange number
        exchangeNumber = correctExchangeNumber;
        logger.info('🔧 FIXED: Exchange number corrected from', {
          previous: exchangeNumber !== correctExchangeNumber ? exchangeNumber : 'N/A',
          corrected: exchangeNumber,
          currentRoundNumber,
        });
      }

      logger.info('📝 Analyzer starting new round', {
        currentRoundNumber,
        lastCompletedRound: lastCompletedRoundNumber,
        respondingPersonaName,
        exchangeNumber,
        correctExchangeNumber,
        formulaResult,
        verifiedCorrect: exchangeNumber === correctExchangeNumber && exchangeNumber === formulaResult,
      });
      return formatNewRoundPrompt(
        topic,
        summaryContext,
        fileInfo,
        conversationTranscript,
        currentRoundNumber!,
        exchangeNumber,
        lastCompletedRoundNumber,
        otherPersona,
        lastMessage
      );
    }

    // CRITICAL FIX: Use currentRoundNumber directly if available, otherwise calculate from exchangeNumber
    // ROOT CAUSE: If exchangeNumber was calculated incorrectly earlier, recalculating roundNum from it
    // will also be wrong. We should use currentRoundNumber as the source of truth when available.
    let roundNum: number;
    if (currentRoundNumber !== undefined) {
      // Use currentRoundNumber as source of truth - it's more reliable than recalculating from exchangeNumber
      roundNum = currentRoundNumber;

      // CRITICAL FIX: Verify the calculation matches (defensive check)
      const calculatedRoundFromExchange = Math.floor((exchangeNumber - 1) / 3) + 1;
      if (roundNum !== calculatedRoundFromExchange) {
        logger.error('🚨 CRITICAL: Round number mismatch detected!', {
          currentRoundNumber: roundNum,
          calculatedRoundFromExchange,
          exchangeNumber,
          formula: `Math.floor((${exchangeNumber} - 1) / 3) + 1 = ${calculatedRoundFromExchange}`,
          respondingPersonaName,
          note: 'Using currentRoundNumber as source of truth, exchangeNumber may be incorrect',
        });
      }
    } else {
      // Fallback: Calculate from exchange number if currentRoundNumber not available
      // Turn number = (roundNumber - 1) * 3 + position
      // Position 1 = Analyzer, Position 2 = Solver, Position 3 = Moderator
      roundNum = Math.floor((exchangeNumber - 1) / 3) + 1;
      logger.warn('⚠️ WARNING: currentRoundNumber not available, calculating from exchangeNumber', {
        exchangeNumber,
        calculatedRoundNum: roundNum,
        respondingPersonaName,
      });
    }

    return formatContinuationPrompt(
      topic,
      summaryContext,
      fileInfo,
      conversationTranscript,
      roundNum,
      exchangeNumber,
      otherPersona,
      lastMessage
    );
  }

  // Fallback if no last message (shouldn't happen, but handle gracefully)
  // This can happen when Analyzer starts Round 1 with no previous context
  logger.warn('formatLLMPrompt: No last message found, using fallback', {
    respondingPersonaName,
    roundsCount: rounds?.length || 0,
    messagesCount: conversationMessages.length,
    isFirstMessage,
    currentRoundNumber,
  });

  // If this is truly the first message (Analyzer starting Round 1), use first message prompt
  if (isFirstMessage || (currentRoundNumber === 1 && respondingPersonaName === 'Analyzer AI' && conversationTranscript === '')) {
    return formatFirstMessagePrompt(topic, summaryContext, userAnswersSection, fileInfo);
  }

  return `Topic: "${topic}"${summaryContext}${fileInfo}

Full conversation so far:

${conversationTranscript}

---

Continue the collaborative dialogue. Build on the conversation, add new perspectives, ask clarifying questions, or challenge assumptions constructively. This is a real dialogue - make it feel like you're actively engaging with the discussion. Write 2-4 paragraphs that feel conversational and readable. Always complete your full thought - ensure your response is complete and well-formed within the token limit.`;
}
