'use client';

import { FileText, Trash2 } from 'lucide-react';

interface InitialTopicDisplayProps {
  topic: string;
  discussionId: string | null;
  onDelete?: () => void;
}

export function InitialTopicDisplay({ topic, discussionId, onDelete }: InitialTopicDisplayProps) {
  return (
    <div className="bg-gray-800/40 rounded-lg p-4 mb-6 border border-gray-600/50">
      <div className="flex items-start gap-3">
        <FileText className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-gray-300 font-semibold text-sm">Initial Topic</h3>
            {discussionId && onDelete && (
              <button
                onClick={onDelete}
                className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded transition-colors"
                title="Delete discussion"
                aria-label="Delete discussion"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-white text-sm whitespace-pre-wrap">{topic}</p>
        </div>
      </div>
    </div>
  );
}
