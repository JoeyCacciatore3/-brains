'use client';

import type { DiscussionRound } from '@/types';
import { MessageBubble } from './MessageBubble';

interface RoundDisplayProps {
  round: DiscussionRound;
  isCurrentRound?: boolean;
  moderatorError?: string; // Deprecated: No longer used (Moderator AI participates directly in discussions, not as summary generator)
}

// Helper function to validate a message
function isValidMessage(message: any): message is { content: string; persona: string; turn: number } {
  return (
    message &&
    typeof message === 'object' &&
    typeof message.content === 'string' &&
    typeof message.persona === 'string' &&
    typeof message.turn === 'number'
  );
}

export function RoundDisplay({ round, isCurrentRound = false }: RoundDisplayProps) {
  // Validate round structure
  if (!round) {
    return (
      <div className="mb-6 p-4 border-2 border-red-500 rounded">
        <p className="text-red-400">Error: Round data is missing</p>
      </div>
    );
  }

  // Validate all three responses exist and are valid
  const hasValidAnalyzer = isValidMessage(round.analyzerResponse);
  const hasValidSolver = isValidMessage(round.solverResponse);
  const hasValidModerator = isValidMessage(round.moderatorResponse);

  // If any response is missing, show error but don't crash
  if (!hasValidAnalyzer || !hasValidSolver || !hasValidModerator) {
    return (
      <div className={`mb-6 ${isCurrentRound ? 'animate-fade-in' : ''}`}>
        <div className="mb-3 flex items-center gap-2 border-b-2 border-yellow-500 pb-2">
          <h3 className="text-white font-semibold text-lg">Round {round.roundNumber || '?'}</h3>
          <span className="text-yellow-400 text-sm">⚠️ Incomplete data</span>
        </div>
        <div className="p-4 border-2 border-yellow-500 rounded">
          <p className="text-yellow-400 text-sm mb-2">Warning: Some responses are missing or invalid:</p>
          <ul className="text-yellow-300 text-xs list-disc list-inside space-y-1">
            {!hasValidAnalyzer && <li>Analyzer AI response is missing</li>}
            {!hasValidSolver && <li>Solver AI response is missing</li>}
            {!hasValidModerator && <li>Moderator AI response is missing</li>}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className={`mb-6 ${isCurrentRound ? 'animate-fade-in' : ''}`}>
      <div className="mb-3 flex items-center gap-2 border-b-2 border-green-500 pb-2">
        <h3 className="text-white font-semibold text-lg">Round {round.roundNumber}</h3>
        <span className="text-gray-400 text-sm">
          {round.timestamp ? new Date(round.timestamp).toLocaleString() : 'No timestamp'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {/* Analyzer AI Response - Left column */}
        <div className="flex flex-col">
          <MessageBubble
            message={round.analyzerResponse}
            streamingContent={undefined}
            isStreaming={false}
          />
        </div>

        {/* Solver AI Response - Middle column */}
        <div className="flex flex-col">
          <MessageBubble
            message={round.solverResponse}
            streamingContent={undefined}
            isStreaming={false}
          />
        </div>

        {/* Moderator AI Response - Right column */}
        <div className="flex flex-col">
          <MessageBubble
            message={round.moderatorResponse}
            streamingContent={undefined}
            isStreaming={false}
          />
        </div>
      </div>
    </div>
  );
}
