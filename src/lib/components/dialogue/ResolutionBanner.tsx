import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

interface ResolutionBannerProps {
  solution?: string;
  finalizedSummary?: string; // Prioritized over solution - collaborative final answer
  confidence?: number;
  onDismiss?: () => void;
}

export function ResolutionBanner({ solution, finalizedSummary, confidence, onDismiss }: ResolutionBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const maxLength = 500;

  // Prioritize finalizedSummary over solution (finalized summary is the official collaborative answer)
  const displayText = finalizedSummary || solution;
  const isTruncated = displayText && displayText.length > maxLength;
  const displayContent = isTruncated && !isExpanded ? displayText.slice(0, maxLength) + '...' : displayText;
  const isHighConfidence = confidence !== undefined && confidence > 0.85; // Updated threshold to match config

  return (
    <div className="bg-black border-2 border-green-500 rounded p-4 mb-6 animate-slide-in">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-green-500 font-bold text-lg">
              {finalizedSummary ? 'Consensus Reached - Final Answer' : 'Solution Reached'}
            </h3>
            {isHighConfidence && (
              <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
                High Confidence
              </span>
            )}
          </div>
          {displayContent ? (
            <div className="text-white text-sm space-y-2">
              <p className="font-medium text-green-400">
                {finalizedSummary ? 'Finalized Answer:' : 'Solution:'}
              </p>
              <p className="text-white whitespace-pre-wrap">{displayContent}</p>
              {isTruncated && (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="text-green-500 hover:text-green-400 text-xs underline"
                  type="button"
                >
                  {isExpanded ? 'Show less' : 'Read more'}
                </button>
              )}
            </div>
          ) : (
            <p className="text-white text-sm">
              The AIs have arrived at a resolution. Review the conversation above for the final
              solution.
            </p>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-green-500 hover:text-green-400 text-sm"
            type="button"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
