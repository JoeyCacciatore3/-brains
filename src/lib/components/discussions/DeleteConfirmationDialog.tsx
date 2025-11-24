'use client';

import { useState } from 'react';
import { X, Trash2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface DeleteConfirmationDialogProps {
  discussionId: string;
  topic: string;
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteConfirmationDialog({
  discussionId,
  topic,
  isOpen,
  onClose,
  onDeleted,
}: DeleteConfirmationDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/discussions/${discussionId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete discussion');
      }

      toast.success('Discussion deleted successfully');
      onDeleted();
      onClose();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete discussion';
      toast.error(errorMessage);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-black border-2 border-red-500 rounded-lg p-6 max-w-md w-full">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              Delete Discussion
            </h2>
            <button
              onClick={onClose}
              disabled={isDeleting}
              className="text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-white mb-2">
            Are you sure you want to delete this discussion?
          </p>
          <p className="text-gray-300 text-sm mb-6 p-3 bg-gray-900 rounded border border-gray-700">
            &quot;{topic.length > 100 ? `${topic.substring(0, 100)}...` : topic}&quot;
          </p>
          <p className="text-red-400 text-sm mb-6">
            This action cannot be undone. All messages and data will be permanently deleted.
          </p>

          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Delete
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
