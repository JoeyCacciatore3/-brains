import type { ConversationMessage, DiscussionRound, SummaryEntry } from '@/types';
import type { FileData } from '@/lib/validation';
import { readDiscussion } from '@/lib/discussions/file-manager';
import { countTokens } from '@/lib/discussions/token-counter';
import { logger } from '@/lib/logger';
import { aiPersonas } from '@/lib/llm';

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
  rounds: DiscussionRound[]; // New: round-based structure
  summary?: string; // Legacy: kept for backward compatibility
  currentSummary?: SummaryEntry; // New: most recent summary with metadata
  summaries: SummaryEntry[]; // New: all summaries
  tokenCount: number; // New: calculated token count for context
}> {
  const discussionData = await readDiscussion(discussionId, userId);

  // Calculate token count for context
  let tokenCount = 0;

  // Account for system prompt tokens (average across personas, ~250 tokens each)
  // We count system prompt once per round exchange (all three personas use system prompts)
  const systemPromptTokens = Math.max(
    countTokens(aiPersonas.solver.systemPrompt),
    countTokens(aiPersonas.analyzer.systemPrompt),
    countTokens(aiPersonas.moderator.systemPrompt)
  );

  // Account for formatting overhead (markdown, separators, prompt structure)
  // Estimated overhead per prompt: ~50-100 tokens for structure
  const formattingOverhead = 75;

  // If summary exists, use it (replaces old rounds)
  if (discussionData.currentSummary) {
    // Use tokenCountAfter from summary metadata instead of recalculating
    // This ensures accuracy and reflects the actual state after summarization
    tokenCount = discussionData.currentSummary.tokenCountAfter;

    // Add tokens for rounds after summary
    if (discussionData.rounds) {
      const summaryRound = discussionData.currentSummary.roundNumber;
      const roundsAfterSummary = discussionData.rounds.filter((r) => r.roundNumber > summaryRound);
      tokenCount += roundsAfterSummary.reduce((sum, round) => {
        return (
          sum +
          countTokens(round.solverResponse.content) +
          countTokens(round.analyzerResponse.content) +
          countTokens(round.moderatorResponse.content)
        );
      }, 0);
    }

    // Add system prompt and formatting overhead for remaining rounds
    // Each round has 3 responses, so multiply by 3
    const roundsAfterSummaryCount = discussionData.rounds
      ? discussionData.rounds.filter((r) => r.roundNumber > discussionData.currentSummary!.roundNumber)
          .length
      : 0;
    tokenCount += roundsAfterSummaryCount * 3 * (systemPromptTokens + formattingOverhead);

    // Validate token count consistency
    const recalculatedSummaryTokens = countTokens(discussionData.currentSummary.summary);
    if (Math.abs(discussionData.currentSummary.tokenCountAfter - recalculatedSummaryTokens) > 10) {
      logger.warn('Token count mismatch in summary metadata', {
        discussionId,
        userId,
        metadataTokenCount: discussionData.currentSummary.tokenCountAfter,
        recalculatedTokenCount: recalculatedSummaryTokens,
        difference: Math.abs(
          discussionData.currentSummary.tokenCountAfter - recalculatedSummaryTokens
        ),
      });
    }
  } else if (discussionData.rounds && discussionData.rounds.length > 0) {
    // No summary, count all rounds
    tokenCount = discussionData.rounds.reduce((sum, round) => {
      return (
        sum +
        countTokens(round.solverResponse.content) +
        countTokens(round.analyzerResponse.content) +
        countTokens(round.moderatorResponse.content)
      );
    }, 0);

    // Add system prompt and formatting overhead for all rounds
    // Each round has 3 responses, so multiply by 3
    tokenCount += discussionData.rounds.length * 3 * (systemPromptTokens + formattingOverhead);
  } else {
    // Fallback to legacy messages
    tokenCount = (discussionData.messages || []).reduce(
      (sum, msg) => sum + countTokens(msg.content),
      0
    );

    // Add system prompt and formatting overhead for legacy messages
    const messageCount = discussionData.messages?.length || 0;
    tokenCount += Math.ceil(messageCount / 2) * (systemPromptTokens + formattingOverhead);
  }

  // Generate messages array on-demand from rounds for LLM prompt formatting
  // Rounds are the primary source of truth. Messages array is derived, not stored.
  let messages: ConversationMessage[] = [];
  if (discussionData.rounds && discussionData.rounds.length > 0) {
    // Convert rounds to messages array on-demand for LLM context
    messages = discussionData.rounds.flatMap((round) => {
      const msgs: ConversationMessage[] = [];
      if (round.solverResponse.content) {
        msgs.push(round.solverResponse);
      }
      if (round.analyzerResponse.content) {
        msgs.push(round.analyzerResponse);
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

  return {
    topic: discussionData.topic,
    messages, // Generated on-demand from rounds (for LLM context formatting)
    rounds: discussionData.rounds || [], // Primary source of truth
    summary: discussionData.summary, // Legacy
    currentSummary: discussionData.currentSummary, // New
    summaries: discussionData.summaries || [], // New
    tokenCount, // New
  };
}

/**
 * Formats conversation context for LLM prompt
 * Returns the user message content that should be sent to the LLM
 * Enhanced to support round-based structure with summaries
 * @param respondingPersonaName - The name of the AI persona that will be responding ('Solver AI', 'Analyzer AI', or 'Moderator AI')
 * @param summary - Optional summary to include at the beginning for context (legacy)
 * @param rounds - Optional rounds array (new round-based structure)
 * @param currentSummary - Optional current summary entry with metadata (new)
 * @param userAnswers - Optional user answers to questions from previous rounds
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
  userAnswers?: Record<string, string[]> // New: questionId -> selected option IDs
): string {
  // Format file information for text-based providers
  const fileInfo =
    files && files.length > 0
      ? `\n\nAdditional context provided:\n${files
          .map(
            (file, idx) =>
              `- File ${idx + 1}: ${file.name} (${file.type}, ${(file.size / 1024).toFixed(1)}KB)`
          )
          .join('\n')}`
      : '';

  // Include all summaries in chronological order (before current summary)
  const allSummariesSection =
    summaries && summaries.length > 0
      ? `\n\n## Discussion History (Summarized)\n${summaries
          .sort((a, b) => a.roundNumber - b.roundNumber)
          .map(
            (s, idx) =>
              `### Summary ${idx + 1} (Round ${s.roundNumber})\n` +
              `Replaces rounds: ${s.replacesRounds.join(', ')}\n` +
              `${s.summary}`
          )
          .join('\n\n---\n\n')}\n\n---\n`
      : '';

  // Use currentSummary if available (new), fallback to legacy summary
  const summaryToUse = currentSummary?.summary || summary;
  const summarySection = summaryToUse
    ? `\n\n## Discussion Summary (for context)\n${summaryToUse}\n\n---\n`
    : '';

  // Format user answers if provided
  const userAnswersSection =
    userAnswers && Object.keys(userAnswers).length > 0
      ? `\n\n## User Input from Previous Questions\n${Object.entries(userAnswers)
          .map(([, selectedOptions]) => {
            // Find question text (would need to search rounds, simplified here)
            return `- Selected: ${selectedOptions.join(', ')}`;
          })
          .join('\n')}\n\n---\n`
      : '';

  if (isFirstMessage) {
    return `You are starting a collaborative discussion about: "${topic}"${allSummariesSection}${summarySection}${userAnswersSection}${fileInfo}

Provide your initial analysis or approach to this topic (2-4 paragraphs). Set the stage for a productive back-and-forth conversation. Be engaging and thoughtful - you're starting a dialogue that will evolve through multiple exchanges.`;
  }

  // Use rounds if available (new structure), fallback to legacy messages
  let conversationTranscript = '';
  let lastMessage: ConversationMessage | null = null;
  let exchangeNumber = 1;

  logger.debug('formatLLMPrompt called', {
    respondingPersonaName,
    isFirstMessage,
    roundsCount: rounds?.length || 0,
    messagesCount: conversationMessages.length,
    hasSummary: !!summaryToUse,
  });

  if (rounds && rounds.length > 0) {
    // Format rounds as conversation transcript
    const roundsToInclude = currentSummary
      ? rounds.filter((r) => r.roundNumber > currentSummary.roundNumber) // Only rounds after summary
      : rounds; // All rounds if no summary

    // Check for incomplete round (Solver responded but Analyzer hasn't yet)
    // Must check BEFORE filtering completed rounds to prevent duplication
    const incompleteRound = roundsToInclude.find(
      (r) => r.solverResponse.content && (!r.analyzerResponse.content || !r.moderatorResponse.content)
    );

    // Build transcript from completed rounds (all three AIs have responded)
    // Exclude incomplete round to prevent duplication
    const completedRounds = roundsToInclude.filter(
      (r) =>
        r.solverResponse.content &&
        r.analyzerResponse.content &&
        r.moderatorResponse.content &&
        (!incompleteRound || r.roundNumber !== incompleteRound.roundNumber)
    );

    // Format completed rounds
    if (completedRounds.length > 0) {
      conversationTranscript = completedRounds
        .map((round) => {
          return `[Round ${round.roundNumber}]\n${round.solverResponse.persona}: ${round.solverResponse.content}\n\n${round.analyzerResponse.persona}: ${round.analyzerResponse.content}\n\n${round.moderatorResponse.persona}: ${round.moderatorResponse.content}`;
        })
        .join('\n\n---\n\n');
    }

    // If there's an incomplete round, add partial responses to transcript
    // Order: Solver -> Analyzer -> Moderator
    if (incompleteRound) {
      if (conversationTranscript) {
        conversationTranscript += '\n\n---\n\n';
      }
      conversationTranscript += `[Round ${incompleteRound.roundNumber}]\n${incompleteRound.solverResponse.persona}: ${incompleteRound.solverResponse.content}`;
      if (incompleteRound.analyzerResponse?.content) {
        conversationTranscript += `\n\n${incompleteRound.analyzerResponse.persona}: ${incompleteRound.analyzerResponse.content}`;
      }
      if (incompleteRound.moderatorResponse?.content) {
        conversationTranscript += `\n\n${incompleteRound.moderatorResponse.persona}: ${incompleteRound.moderatorResponse.content}`;
      }
    }

    // Determine last message and exchange number based on rounds structure
    // Order: Solver -> Analyzer -> Moderator
    if (incompleteRound) {
      // Determine which response we're waiting for
      if (!incompleteRound.analyzerResponse?.content) {
        // Waiting for Analyzer (after Solver)
        lastMessage = incompleteRound.solverResponse;
        exchangeNumber = incompleteRound.roundNumber;
      } else if (!incompleteRound.moderatorResponse?.content) {
        // Waiting for Moderator (after Analyzer)
        lastMessage = incompleteRound.analyzerResponse;
        exchangeNumber = incompleteRound.roundNumber;
      } else {
        // Shouldn't happen, but fallback
        lastMessage = incompleteRound.moderatorResponse;
        exchangeNumber = incompleteRound.roundNumber;
      }
    } else if (completedRounds.length > 0) {
      // All rounds are complete - determine who should respond next
      const lastRound = completedRounds[completedRounds.length - 1];

      // In round-based system: Round N has Solver -> Analyzer -> Moderator
      // Round N+1 starts with Solver again
      // So if we're starting a new round, Solver responds first
      // Last message was Moderator from previous round
      lastMessage = lastRound.moderatorResponse;
      exchangeNumber = lastRound.roundNumber + 1;
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
    return `Topic: "${topic}"${allSummariesSection}${summarySection}${fileInfo}

Full conversation so far:

${conversationTranscript}

---

The user has provided the following input:

"${lastMessage.content}"

Please respond to the user's input. Address their question or concern directly. If they're providing clarification or additional context, incorporate that into your response. Continue the collaborative dialogue by building on the conversation so far and the user's input. Reference specific points from the conversation and the user's message. Write 2-4 paragraphs that feel conversational and readable.`;
  }

  // Determine which AI should respond based on rounds or responding persona
  // Order: Solver -> Analyzer -> Moderator
  let otherPersona: 'Solver AI' | 'Analyzer AI' | 'Moderator AI';

  if (rounds && rounds.length > 0 && lastMessage) {
    // In round-based system with 3 personas, determine based on last message and responding persona
    // Flow: Solver -> Analyzer -> Moderator -> (next round) Solver
    if (lastMessage.persona === 'Solver AI') {
      // After Solver, next is Analyzer or Moderator
      otherPersona = respondingPersonaName === 'Moderator AI' ? 'Analyzer AI' : 'Analyzer AI';
    } else if (lastMessage.persona === 'Analyzer AI') {
      // After Analyzer, next is Moderator or Solver (new round)
      otherPersona = respondingPersonaName === 'Moderator AI' ? 'Analyzer AI' : 'Solver AI';
    } else if (lastMessage.persona === 'Moderator AI') {
      // After Moderator, next round starts with Solver
      otherPersona = 'Solver AI';
    } else {
      // Fallback
      otherPersona = 'Analyzer AI';
    }
  } else if (lastMessage) {
    // Legacy: determine from last message
    otherPersona = lastMessage.persona === 'Solver AI' ? 'Analyzer AI' : lastMessage.persona === 'Analyzer AI' ? 'Moderator AI' : 'Solver AI';
  } else {
    // Fallback: use responding persona name to determine other
    // This shouldn't happen in normal flow, but handle gracefully
    if (respondingPersonaName === 'Solver AI') {
      otherPersona = 'Analyzer AI';
    } else if (respondingPersonaName === 'Analyzer AI') {
      otherPersona = 'Moderator AI';
    } else {
      otherPersona = 'Solver AI';
    }
  }

  // If we have a last message, use it; otherwise provide general context
  if (lastMessage) {
    logger.debug('formatLLMPrompt: Using last message context', {
      respondingPersonaName,
      lastMessagePersona: lastMessage.persona,
      otherPersona,
      exchangeNumber,
      lastMessageLength: lastMessage.content.length,
    });

    return `Topic: "${topic}"${allSummariesSection}${summarySection}${fileInfo}

Full conversation so far:

${conversationTranscript}

---

You are now in Exchange ${exchangeNumber}. ${otherPersona} just said:

"${lastMessage.content}"

Respond directly to what they just said. Reference specific points they made. Build on their ideas, challenge assumptions constructively, ask clarifying questions, or add new perspectives. This is a real dialogue - make it feel like you're actively engaging with their thoughts, not just making isolated statements. Use natural transitions and references to create a flowing conversation. Write 2-4 paragraphs that feel conversational and readable.`;
  }

  // Fallback if no last message (shouldn't happen, but handle gracefully)
  logger.warn('formatLLMPrompt: No last message found, using fallback', {
    respondingPersonaName,
    roundsCount: rounds?.length || 0,
    messagesCount: conversationMessages.length,
  });

  return `Topic: "${topic}"${allSummariesSection}${summarySection}${fileInfo}

Full conversation so far:

${conversationTranscript}

---

Continue the collaborative dialogue. Build on the conversation, add new perspectives, ask clarifying questions, or challenge assumptions constructively. This is a real dialogue - make it feel like you're actively engaging with the discussion. Write 2-4 paragraphs that feel conversational and readable.`;
}
