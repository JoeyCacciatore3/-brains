'use client';

import { FileText } from 'lucide-react';

interface InitialTopicDisplayProps {
  topic: string;
}

export function InitialTopicDisplay({ topic }: InitialTopicDisplayProps) {
  return (
    <div className="bg-black rounded p-4 mb-6 border-2 border-green-500">
      <div className="flex items-start gap-3">
        <FileText className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-green-500 font-semibold mb-2 text-sm">Initial Topic</h3>
          <p className="text-white text-sm whitespace-pre-wrap">{topic}</p>
        </div>
      </div>
    </div>
  );
}
