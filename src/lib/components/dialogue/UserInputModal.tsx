'use client';

import { useState, useEffect } from 'react';
import { X, Send, AlertCircle } from 'lucide-react';
import { Button } from '@/lib/components/ui/Button';
import { LoadingSpinner } from '@/lib/components/ui/LoadingSpinner';

interface UserInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: string) => void;
  isProcessing?: boolean;
  error?: string | null;
}

export function UserInputModal({
  isOpen,
  onClose,
  onSubmit,
  isProcessing = false,
  error: externalError,
}: UserInputModalProps) {
  const [input, setInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const error = externalError || localError;

  // Reset input when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setInput('');
      setLocalError(null);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isProcessing) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, isProcessing, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!input.trim()) {
      setLocalError('Please enter your input before submitting.');
      return;
    }

    if (input.trim().length < 10) {
      setLocalError('Input must be at least 10 characters long.');
      return;
    }

    if (input.trim().length > 1000) {
      setLocalError('Input must be less than 1000 characters.');
      return;
    }

    onSubmit(input.trim());
    // Don't close here - let parent handle it after successful submission
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-black border-2 border-green-500 rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">Add Your Input</h2>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="text-white hover:text-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            type="button"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Description */}
        <p className="text-gray-400 text-sm mb-4">
          Add your input to direct the current discussion. This will be sent to the AIs to guide their conversation.
        </p>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-black border-2 border-green-500 rounded flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span className="text-white text-sm flex-1">{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setLocalError(null);
            }}
            placeholder="Enter your input here... (minimum 10 characters)"
            className="flex-1 p-4 rounded bg-black border-2 border-green-500 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none mb-4"
            disabled={isProcessing}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleSubmit(e);
              }
            }}
          />

          {/* Character Count */}
          <div className="text-gray-400 text-xs mb-4 text-right">
            {input.length} / 1000 characters
          </div>

          {/* Buttons */}
          <div className="flex gap-3 justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!input.trim() || input.trim().length < 10 || isProcessing}
              className="flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <LoadingSpinner className="w-4 h-4" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Submit Input
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
