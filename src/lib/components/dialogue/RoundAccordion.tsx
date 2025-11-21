'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, FileText, HelpCircle, Copy, Clock } from 'lucide-react';
import type { DiscussionRound, SummaryEntry } from '@/types';
import { RoundDisplay } from './RoundDisplay';
import { Button } from '@/lib/components/ui/Button';
import { clientLogger } from '@/lib/client-logger';

interface RoundAccordionProps {
  rounds: DiscussionRound[];
  currentRoundNumber: number | null;
  summaries?: SummaryEntry[]; // Optional: to show summary indicators
}

// Helper function to validate a round
function isValidRound(round: any): round is DiscussionRound {
  if (!round || typeof round !== 'object') return false;
  if (typeof round.roundNumber !== 'number') return false;
  if (typeof round.timestamp !== 'string') return false;
  if (!round.solverResponse || typeof round.solverResponse.content !== 'string') return false;
  if (!round.analyzerResponse || typeof round.analyzerResponse.content !== 'string') return false;
  if (!round.moderatorResponse || typeof round.moderatorResponse.content !== 'string') return false;
  return true;
}

export function RoundAccordion({
  rounds,
  currentRoundNumber,
  summaries = [],
}: RoundAccordionProps) {
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set());

  // Filter out invalid rounds and current round - only show previous valid rounds
  const previousRounds = rounds
    .filter(isValidRound)
    .filter((round) => currentRoundNumber === null || round.roundNumber < currentRoundNumber);

  if (previousRounds.length === 0) {
    return null;
  }

  const toggleRound = (roundNumber: number) => {
    setExpandedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(roundNumber)) {
        next.delete(roundNumber);
      } else {
        next.add(roundNumber);
      }
      return next;
    });
  };

  // Check if a round is summarized
  const isRoundSummarized = (roundNumber: number): boolean => {
    return summaries.some((s) => s.replacesRounds.includes(roundNumber));
  };

  // Format relative timestamp
  const formatRelativeTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  // Copy round content to clipboard
  const copyRoundContent = async (round: DiscussionRound) => {
    // Validate round data before copying
    if (
      !round.solverResponse?.content ||
      !round.analyzerResponse?.content ||
      !round.moderatorResponse?.content
    ) {
      clientLogger.warn('Cannot copy round content: incomplete data', {
        roundNumber: round.roundNumber,
      });
      return;
    }

    const content = `Round ${round.roundNumber}\n\n${round.analyzerResponse.persona}: ${round.analyzerResponse.content}\n\n${round.solverResponse.persona}: ${round.solverResponse.content}\n\n${round.moderatorResponse.persona}: ${round.moderatorResponse.content}`;
    try {
      await navigator.clipboard.writeText(content);
      // Could show a toast notification here
    } catch (err) {
      clientLogger.error('Failed to copy round content to clipboard', {
        error: err instanceof Error ? err.message : String(err),
        roundNumber: round.roundNumber,
      });
    }
  };

  return (
    <div className="mt-6 space-y-2">
      <h3 className="text-white font-semibold text-lg mb-4">Previous Rounds</h3>
      {previousRounds
        .sort((a, b) => b.roundNumber - a.roundNumber) // Show most recent first
        .map((round) => {
          const isExpanded = expandedRounds.has(round.roundNumber);
          const hasQuestions = !!round.questions && round.questions.questions.length > 0;
          const isSummarized = isRoundSummarized(round.roundNumber);

          return (
            <div
              key={round.roundNumber}
              className={`border-2 rounded overflow-hidden transition-all duration-300 ${
                isExpanded
                  ? 'border-green-500 bg-black shadow-lg'
                  : 'border-green-500 bg-black hover:border-green-400'
              }`}
            >
              <button
                onClick={() => toggleRound(round.roundNumber)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-black transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-green-500 flex-shrink-0 transition-transform" />
                  ) : (
                    <ChevronUp className="w-5 h-5 text-green-500 flex-shrink-0 transition-transform" />
                  )}
                  <span className="text-white font-medium flex-shrink-0">
                    Round {round.roundNumber}
                  </span>

                  {/* Visual Indicators */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isSummarized && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-black text-green-500 border-2 border-green-500"
                        title="This round has been summarized"
                      >
                        <FileText className="w-3 h-3" />
                        Summarized
                      </span>
                    )}
                    {hasQuestions && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-black text-green-500 border-2 border-green-500"
                        title="This round has questions"
                      >
                        <HelpCircle className="w-3 h-3" />
                        Questions
                      </span>
                    )}
                  </div>

                  <span className="text-gray-400 text-sm flex items-center gap-1 ml-auto flex-shrink-0">
                    <Clock className="w-3 h-3" />
                    {formatRelativeTime(round.timestamp)}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 pt-2 border-t-2 border-green-500 animate-fade-in">
                  <RoundDisplay
                    round={round}
                    isCurrentRound={false}
                  />

                  {/* Per-Round Action Buttons */}
                  <div className="mt-4 flex flex-wrap gap-2 pt-3 border-t-2 border-green-500">
                    <Button
                      variant="secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyRoundContent(round);
                      }}
                      className="text-xs py-1.5 px-3"
                    >
                      <Copy className="w-3 h-3 mr-1.5" />
                      Copy Content
                    </Button>
                    {hasQuestions && (
                      <Button
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Scroll to questions if they exist
                          // This could be enhanced to show questions in a modal or expand them
                        }}
                        className="text-xs py-1.5 px-3"
                      >
                        <HelpCircle className="w-3 h-3 mr-1.5" />
                        View Questions
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
