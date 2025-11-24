import { getProviderWithFallback, aiPersonas } from './index';
import { logger } from '@/lib/logger';
import { hasReachedThreshold, countTokens } from '@/lib/discussions/token-counter';
import {
  readDiscussion,
  updateDiscussionWithSummary,
  addSummaryToDiscussion,
} from '@/lib/discussions/file-manager';
import { updateDiscussion } from '@/lib/db/discussions';
import { LLM_CONFIG } from '@/lib/config';
import type { LLMMessage } from './types';
import type { SummaryEntry, DiscussionRound } from '@/types';

/**
 * Check if discussion has reached the 60% token threshold
 */
export function shouldSummarize(tokenCount: number, tokenLimit: number): boolean {
  return hasReachedThreshold(tokenCount, tokenLimit);
}

/**
 * Generate a summary of the discussion using the summarizer LLM
 * Legacy function - kept for backward compatibility
 */
export async function generateSummary(
  discussionId: string,
  userId: string,
  topic: string,
  messages: Array<{ persona: string; content: string; timestamp: string }>
): Promise<string> {
  const summarizerPersona = aiPersonas.summarizer;

  try {
    // Use SUMMARY_MAX_TOKENS for summaries
    const provider = getProviderWithFallback(summarizerPersona.provider, {
      maxTokens: LLM_CONFIG.SUMMARY_MAX_TOKENS,
    });

    // Format messages for summarization
    const conversationText = messages
      .map(
        (msg) => `[${msg.persona}] (${new Date(msg.timestamp).toLocaleString()}): ${msg.content}`
      )
      .join('\n\n');

    const prompt = `Please create a comprehensive summary of the following discussion about "${topic}".

Discussion transcript:
${conversationText}

Create a clear, structured summary that:
1. States the main topic or problem
2. Highlights key insights and conclusions
3. Notes important decisions or recommendations
4. Mentions any open questions or areas needing further exploration
5. Preserves essential context for future reference

Keep the summary concise but comprehensive enough to maintain full context awareness.

IMPORTANT: Ensure your summary is a complete thought and ends naturally, even if you must be more concise. Always finish with proper punctuation and a complete sentence. Never cut off mid-thought - if approaching the token limit, conclude your summary naturally rather than being truncated.`;

    const llmMessages: LLMMessage[] = [
      { role: 'system', content: summarizerPersona.systemPrompt },
      { role: 'user', content: prompt },
    ];

    logger.info('Generating summary for discussion', {
      discussionId,
      userId,
      messageCount: messages.length,
    });

    let summary = '';
    await provider.stream(llmMessages, (chunk: string) => {
      if (typeof chunk === 'string') {
        summary += chunk;
      }
    });

    if (!summary || summary.trim().length === 0) {
      throw new Error('Summarizer returned empty response');
    }

    logger.info('Summary generated successfully', {
      discussionId,
      userId,
      summaryLength: summary.length,
    });
    return summary.trim();
  } catch (error) {
    logger.error('Error generating summary', { error, discussionId, userId });
    throw error;
  }
}

/**
 * Generate a comprehensive summary with metadata for round-based discussions
 * This is the new enhanced version that creates SummaryEntry objects
 */
export async function generateComprehensiveSummary(
  discussionId: string,
  userId: string,
  topic: string,
  rounds: DiscussionRound[],
  previousSummaries: SummaryEntry[] = [],
  currentRound: number
): Promise<SummaryEntry> {
  const summarizerPersona = aiPersonas.summarizer;

  try {
    // Use SUMMARY_MAX_TOKENS for summaries
    const provider = getProviderWithFallback(summarizerPersona.provider, {
      maxTokens: LLM_CONFIG.SUMMARY_MAX_TOKENS,
    });

    // Calculate token count before summarization
    const tokenCountBefore = rounds.reduce((sum, round) => {
      return (
        sum +
        countTokens(round.solverResponse.content) +
        countTokens(round.analyzerResponse.content) +
        countTokens(round.moderatorResponse.content)
      );
    }, 0);

    // Format rounds for summarization
    // Order: Analyzer -> Solver -> Moderator
    const roundsText = rounds
      .map((round) => {
        return `[Round ${round.roundNumber}]
${round.analyzerResponse.persona}: ${round.analyzerResponse.content}

${round.solverResponse.persona}: ${round.solverResponse.content}

${round.moderatorResponse.persona}: ${round.moderatorResponse.content}

${round.questions ? `Questions asked: ${round.questions.questions.map((q) => q.text).join('; ')}` : ''}
${round.userAnswers ? `User answers: ${round.userAnswers.join(', ')}` : ''}`;
      })
      .join('\n\n---\n\n');

    // Include previous summaries if they exist
    const previousSummariesText =
      previousSummaries.length > 0
        ? `\n\nPrevious Summaries:\n${previousSummaries
            .map((s, idx) => `Summary ${idx + 1} (Round ${s.roundNumber}):\n${s.summary}`)
            .join('\n\n')}`
        : '';

    const prompt = `Please create a comprehensive summary of the following discussion about "${topic}".

Discussion rounds:
${roundsText}${previousSummariesText}

CRITICAL REQUIREMENTS for this summary:
1. **Comprehensive**: Include ALL key points, decisions, conclusions, and important details
2. **Detailed**: Preserve the conversation flow and narrative - make it feel like a natural continuation
3. **Context-Aware**: Maintain full context awareness so future rounds can build seamlessly on this summary
4. **No Loss**: Do NOT lose any critical information, key insights, or important decisions
5. **Structured**: Organize clearly but maintain the flow of the conversation

Create a clear, structured summary that:
- States the main topic or problem being discussed
- Highlights ALL key insights and conclusions reached
- Notes ALL important decisions or recommendations made
- Mentions ALL open questions or areas needing further exploration
- References specific rounds and exchanges when relevant
- Preserves the narrative flow and context
- Includes user answers to questions if provided

The summary will replace the detailed rounds in future context, so it MUST be comprehensive enough to maintain full context awareness while being significantly more concise. Write 3-6 paragraphs that capture the essence while preserving all critical information.

IMPORTANT: Ensure your summary is a complete thought and ends naturally, even if you must be more concise. Always finish with proper punctuation and a complete sentence. Never cut off mid-thought - if approaching the token limit, conclude your summary naturally rather than being truncated.`;

    const llmMessages: LLMMessage[] = [
      { role: 'system', content: summarizerPersona.systemPrompt },
      { role: 'user', content: prompt },
    ];

    logger.info('Generating comprehensive summary', {
      discussionId,
      userId,
      roundCount: rounds.length,
      currentRound,
      tokenCountBefore,
    });

    let summary = '';
    await provider.stream(llmMessages, (chunk: string) => {
      if (typeof chunk === 'string') {
        summary += chunk;
      }
    });

    if (!summary || summary.trim().length === 0) {
      throw new Error('Summarizer returned empty response');
    }

    const trimmedSummary = summary.trim();
    const tokenCountAfter = countTokens(trimmedSummary);
    const tokenReduction = tokenCountBefore - tokenCountAfter;

    // Determine which rounds this summary replaces
    const replacesRounds = rounds.map((r) => r.roundNumber);

    const summaryEntry: SummaryEntry = {
      summary: trimmedSummary,
      createdAt: Date.now(),
      roundNumber: currentRound,
      tokenCountBefore,
      tokenCountAfter,
      replacesRounds,
    };

    logger.info('Comprehensive summary generated successfully', {
      discussionId,
      userId,
      summaryLength: trimmedSummary.length,
      tokenCountBefore,
      tokenCountAfter,
      tokenReduction,
      replacesRounds: replacesRounds.length,
    });

    return summaryEntry;
  } catch (error) {
    logger.error('Error generating comprehensive summary', { error, discussionId, userId });
    throw error;
  }
}

/**
 * Summarize a discussion and update files
 * Legacy function - kept for backward compatibility
 */
export async function summarizeDiscussion(
  discussionId: string,
  userId: string
): Promise<{ summary: string; summaryCreatedAt: number }> {
  try {
    // Read discussion data
    const discussionData = await readDiscussion(discussionId, userId);

    // Generate summary
    const summary = await generateSummary(
      discussionId,
      userId,
      discussionData.topic,
      (discussionData.messages || []).map((msg) => ({
        persona: msg.persona,
        content: msg.content,
        timestamp: msg.timestamp,
      }))
    );

    const summaryCreatedAt = Date.now();

    // Update discussion files with summary
    await updateDiscussionWithSummary(discussionId, userId, summary);

    // Update database
    updateDiscussion(discussionId, {
      summary,
      summary_created_at: summaryCreatedAt,
    });

    logger.info('Discussion summarized successfully', { discussionId, userId });
    return { summary, summaryCreatedAt };
  } catch (error) {
    logger.error('Error summarizing discussion', { error, discussionId, userId });
    throw error;
  }
}

/**
 * Summarize rounds and update files with comprehensive summary entry
 * New enhanced version for round-based discussions
 */
export async function summarizeRounds(
  discussionId: string,
  userId: string,
  roundsToSummarize: DiscussionRound[],
  currentRound: number
): Promise<SummaryEntry> {
  try {
    // Read discussion data
    const discussionData = await readDiscussion(discussionId, userId);

    // Get previous summaries
    const previousSummaries = discussionData.summaries || [];

    // Generate comprehensive summary
    const summaryEntry = await generateComprehensiveSummary(
      discussionId,
      userId,
      discussionData.topic,
      roundsToSummarize,
      previousSummaries,
      currentRound
    );

    // Add summary to discussion files
    await addSummaryToDiscussion(discussionId, userId, summaryEntry);

    // Update database with summary reference
    updateDiscussion(discussionId, {
      summary: summaryEntry.summary,
      summary_created_at: summaryEntry.createdAt,
    });

    logger.info('Rounds summarized successfully', {
      discussionId,
      userId,
      roundCount: roundsToSummarize.length,
      summaryRound: summaryEntry.roundNumber,
    });

    return summaryEntry;
  } catch (error) {
    logger.error('Error summarizing rounds', { error, discussionId, userId });
    throw error;
  }
}
