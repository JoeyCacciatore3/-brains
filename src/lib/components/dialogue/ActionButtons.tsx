'use client';

import { useState } from 'react';
import { Button } from '@/lib/components/ui/Button';
import { LoadingSpinner } from '@/lib/components/ui/LoadingSpinner';
import { HelpCircle } from 'lucide-react';

interface ActionButtonsProps {
  onProceed: () => void;
  onGenerateQuestions: () => void;
  isProcessing?: boolean;
  isGeneratingQuestions?: boolean;
  disabled?: boolean;
  discussionId: string | null;
  isResolved?: boolean;
}

// Simple tooltip component
function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black text-white text-xs rounded shadow-lg z-50 whitespace-nowrap border-2 border-green-500">
          {text}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-black"></div>
        </div>
      )}
    </div>
  );
}

export function ActionButtons({
  onProceed,
  onGenerateQuestions,
  isProcessing = false,
  isGeneratingQuestions = false,
  disabled = false,
  discussionId,
  isResolved = false,
}: ActionButtonsProps) {
  // Don't show buttons if no discussion or disabled
  // Note: isResolved check removed - buttons stay visible until true consensus resolution
  // When resolved, the resolution banner will be shown and user can start new discussion
  if (!discussionId || disabled) {
    return null;
  }

  // Hide buttons only when truly resolved (consensus reached)
  if (isResolved) {
    return null;
  }

  const allDisabled = isProcessing || disabled;

  return (
    <div className="flex flex-col items-center gap-4 mt-6 mb-4">
      {/* Contextual Help Text */}
      <div className="flex items-center gap-2 text-white text-sm">
        <HelpCircle className="w-4 h-4 text-green-500" />
        <span>Choose how to continue the discussion</span>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3 justify-center">
        <Tooltip text="Continue to the next round of dialogue between the AIs">
          <Button
            onClick={onProceed}
            disabled={allDisabled || isProcessing}
            className={`min-w-[120px] transition-all ${
              allDisabled || isProcessing
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:scale-105 active:scale-95'
            }`}
          >
            {isProcessing ? (
              <>
                <LoadingSpinner className="mr-2 w-4 h-4" />
                Processing...
              </>
            ) : (
              'Proceed'
            )}
          </Button>
        </Tooltip>

        <Tooltip text="Generate questions about this round to gather your input and guide the discussion">
          <Button
            onClick={onGenerateQuestions}
            disabled={allDisabled || isGeneratingQuestions}
            variant="secondary"
            className={`min-w-[180px] transition-all ${
              allDisabled || isGeneratingQuestions
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:scale-105 active:scale-95'
            }`}
          >
            {isGeneratingQuestions ? (
              <>
                <LoadingSpinner className="mr-2 w-4 h-4" />
                Generating...
              </>
            ) : (
              'Generate Questions'
            )}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
