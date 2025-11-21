import type { ConversationMessage, DiscussionRound, SummaryEntry, QuestionSet } from '@/types';

export interface DiscussionData {
  id: string;
  topic: string;
  userId: string;
  messages?: ConversationMessage[]; // Legacy: kept for backward compatibility
  rounds?: DiscussionRound[]; // New: round-based structure
  summaries?: SummaryEntry[]; // New: array of summaries with metadata
  currentSummary?: SummaryEntry; // New: most recent summary
  questions?: QuestionSet[]; // New: all question sets
  currentRound?: number; // New: current round number
  summary?: string; // Legacy: kept for backward compatibility
  summaryCreatedAt?: number; // Legacy: kept for backward compatibility
  createdAt: number;
  updatedAt: number;
}

/**
 * Format discussion data as JSON for LLM context
 */
export function formatDiscussionJSON(data: DiscussionData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Format discussion data as Markdown for user viewing
 */
export function formatDiscussionMarkdown(data: DiscussionData): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Discussion: ${data.topic}`);
  lines.push('');
  lines.push(`**Created:** ${new Date(data.createdAt).toLocaleString()}`);
  lines.push(`**Last Updated:** ${new Date(data.updatedAt).toLocaleString()}`);
  lines.push('');

  // Summary if exists (use currentSummary if available, fallback to legacy summary)
  const summaryToShow = data.currentSummary?.summary || data.summary;
  if (summaryToShow) {
    lines.push('## Summary');
    lines.push('');
    lines.push(summaryToShow);
    lines.push('');
    const summaryDate = data.currentSummary?.createdAt || data.summaryCreatedAt;
    if (summaryDate) {
      lines.push(`*Summary created: ${new Date(summaryDate).toLocaleString()}*`);
      if (data.currentSummary) {
        lines.push(`*Replaces rounds: ${data.currentSummary.replacesRounds.join(', ')}*`);
        lines.push(
          `*Token reduction: ${data.currentSummary.tokenCountBefore - data.currentSummary.tokenCountAfter} tokens*`
        );
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // Show all summaries if multiple exist
  if (data.summaries && Array.isArray(data.summaries) && data.summaries.length > 1) {
    lines.push('## All Summaries');
    lines.push('');
    data.summaries.forEach((summary, index) => {
      lines.push(`### Summary ${index + 1} (Round ${summary.roundNumber})`);
      lines.push(`*Created: ${new Date(summary.createdAt).toLocaleString()}*`);
      lines.push(`*Replaces rounds: ${summary.replacesRounds.join(', ')}*`);
      lines.push('');
      lines.push(summary.summary);
      lines.push('');
      if (data.summaries && index < data.summaries.length - 1) {
        lines.push('---');
        lines.push('');
      }
    });
    lines.push('---');
    lines.push('');
  }

  // Rounds (new round-based structure)
  if (data.rounds && Array.isArray(data.rounds) && data.rounds.length > 0) {
    lines.push('## Discussion Rounds');
    lines.push('');

    data.rounds.forEach((round, index) => {
      lines.push(`### Round ${round.roundNumber}`);
      lines.push(`*${new Date(round.timestamp).toLocaleString()}*`);
      lines.push('');

      // Solver AI response
      lines.push(`#### ${round.solverResponse.persona}`);
      lines.push(round.solverResponse.content);
      lines.push('');

      // Analyzer AI response
      lines.push(`#### ${round.analyzerResponse.persona}`);
      lines.push(round.analyzerResponse.content);
      lines.push('');

      // Moderator AI response
      lines.push(`#### ${round.moderatorResponse.persona}`);
      lines.push(round.moderatorResponse.content);
      lines.push('');

      // Questions and answers if available
      if (round.questions) {
        lines.push('##### Questions');
        round.questions.questions.forEach((q) => {
          lines.push(`- ${q.text}`);
          if (q.userAnswers && q.userAnswers.length > 0) {
            const selectedOptions = q.options
              .filter((opt) => q.userAnswers?.includes(opt.id))
              .map((opt) => opt.text)
              .join(', ');
            lines.push(`  *User selected: ${selectedOptions}*`);
          }
        });
        lines.push('');
      }

      // Add separator between rounds (except last)
      if (data.rounds && index < data.rounds.length - 1) {
        lines.push('---');
        lines.push('');
      }
    });
  }

  // Legacy messages (for backward compatibility)
  if (
    data.messages &&
    Array.isArray(data.messages) &&
    data.messages.length > 0 &&
    (!data.rounds || !Array.isArray(data.rounds) || data.rounds.length === 0)
  ) {
    lines.push('## Conversation');
    lines.push('');

    data.messages.forEach((message, index) => {
      const timestamp = new Date(message.timestamp).toLocaleString();
      const persona = message.persona;

      lines.push(`### ${persona} (Turn ${message.turn})`);
      lines.push(`*${timestamp}*`);
      lines.push('');
      lines.push(message.content);
      lines.push('');

      // Add separator between messages (except last)
      if (data.messages && index < data.messages.length - 1) {
        lines.push('---');
        lines.push('');
      }
    });
  }

  return lines.join('\n');
}

/**
 * Parse JSON discussion data
 * Ensures backward compatibility by initializing new fields if they don't exist
 */
export function parseDiscussionJSON(json: string): DiscussionData {
  try {
    const data = JSON.parse(json) as DiscussionData;

    // Initialize new fields for backward compatibility
    if (!data.rounds) {
      data.rounds = [];
    }
    if (!data.summaries) {
      data.summaries = [];
    }
    if (!data.questions) {
      data.questions = [];
    }
    if (data.currentRound === undefined) {
      data.currentRound = 0;
    }
    if (!data.messages) {
      data.messages = [];
    }

    return data;
  } catch (error) {
    throw new Error(
      `Failed to parse discussion JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
