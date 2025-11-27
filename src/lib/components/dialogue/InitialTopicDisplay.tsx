'use client';

import { useState } from 'react';
import { FileText, Trash2 } from 'lucide-react';

interface InitialTopicDisplayProps {
  topic: string;
  discussionId: string | null;
  onDelete?: () => void;
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
        <div className="absolute bottom-full right-0 mb-2 px-3 py-2 bg-black text-white text-xs rounded shadow-lg z-50 whitespace-nowrap border-2 border-red-500">
          {text}
          <div className="absolute top-full right-4 -mt-1 border-4 border-transparent border-t-black"></div>
        </div>
      )}
    </div>
  );
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
              <Tooltip text="Delete this discussion permanently">
                <button
                  onClick={onDelete}
                  className="px-3 py-1.5 flex items-center gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-lg transition-all border border-red-500/30 hover:border-red-500/60"
                  title="Delete discussion"
                  aria-label="Delete discussion"
                >
                  <Trash2 className="w-5 h-5" />
                  <span className="text-sm font-medium">Delete</span>
                </button>
              </Tooltip>
            )}
          </div>
          <p className="text-white text-sm whitespace-pre-wrap">{topic}</p>
        </div>
      </div>
    </div>
  );
}
