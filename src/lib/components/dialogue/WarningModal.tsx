'use client';

import { AlertTriangle, X } from 'lucide-react';

interface WarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  topic?: string;
}

export function WarningModal({ isOpen, onClose, onConfirm, topic }: WarningModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-700">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <AlertTriangle className="w-6 h-6 text-yellow-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white mb-2">Active Discussion Found</h3>
            <p className="text-gray-300 mb-4">
              You have an active discussion{topic ? ` about "${topic}"` : ''}. Starting a new
              discussion will create a separate conversation. Would you like to continue?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Start New Discussion
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
