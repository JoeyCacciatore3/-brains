'use client';

import { useState } from 'react';
import { Send, MessageSquare, AlertCircle } from 'lucide-react';
import { Button } from '@/lib/components/ui/Button';

interface UserInputProps {
  question?: string | null;
  onSubmit: (input: string) => void;
  disabled?: boolean;
  error?: string | null;
}

export function UserInput({ question, onSubmit, disabled, error }: UserInputProps) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSubmit(input.trim());
      setInput('');
    }
  };

  return (
    <div className="bg-yellow-500/10 backdrop-blur-lg rounded-xl p-6 mb-6 border border-yellow-500/30">
      <div className="flex items-start gap-3 mb-4">
        <MessageSquare className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-yellow-400 font-semibold mb-2">Your Input Needed</h3>
          {question && <p className="text-gray-300 text-sm mb-3 whitespace-pre-wrap">{question}</p>}
          {error && (
            <div className="mb-3 p-2 bg-red-500/20 border border-red-500/50 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <span className="text-red-200 text-xs flex-1">{error}</span>
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your response here..."
              className="flex-1 p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 min-h-[80px] resize-none"
              disabled={disabled}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleSubmit(e);
                }
              }}
            />
            <Button type="submit" disabled={!input.trim() || disabled} className="self-end">
              <Send className="w-4 h-4 inline mr-2" />
              Send
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
