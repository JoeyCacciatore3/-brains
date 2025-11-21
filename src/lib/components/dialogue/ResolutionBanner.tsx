import { CheckCircle2 } from 'lucide-react';

interface ResolutionBannerProps {
  onDismiss?: () => void;
}

export function ResolutionBanner({ onDismiss }: ResolutionBannerProps) {
  return (
    <div className="bg-black border-2 border-green-500 rounded p-4 mb-6 animate-slide-in">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-green-500 font-bold text-lg mb-1">Solution Reached</h3>
          <p className="text-white text-sm">
            The AIs have arrived at a resolution. Review the conversation above for the final
            solution.
          </p>
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
