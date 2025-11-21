'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/lib/components/ui/Button';

interface RoundNavigationProps {
  currentRound: number;
  totalRounds: number;
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
}

export function RoundNavigation({
  currentRound,
  totalRounds,
  onPrevious,
  onNext,
  disabled = false,
}: RoundNavigationProps) {
  const canGoPrevious = currentRound > 1 && !disabled;
  const canGoNext = currentRound < totalRounds && !disabled;

  return (
    <div className="flex items-center justify-between bg-white/10 backdrop-blur-lg rounded-xl p-4 mb-6 border border-white/20">
      <Button
        onClick={onPrevious}
        disabled={!canGoPrevious}
        variant="secondary"
        className="flex items-center gap-2"
      >
        <ChevronLeft className="w-4 h-4" />
        Previous Round
      </Button>

      <div className="text-white font-medium">
        Round {currentRound} of {totalRounds}
      </div>

      <Button
        onClick={onNext}
        disabled={!canGoNext}
        variant="secondary"
        className="flex items-center gap-2"
      >
        Next Round
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}
