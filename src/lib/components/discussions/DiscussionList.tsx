'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Trash2, Calendar, CheckCircle2, Circle } from 'lucide-react';
import type { Discussion } from '@/lib/db/discussions';
import { DeleteConfirmationDialog } from './DeleteConfirmationDialog';

interface DiscussionListProps {
  discussions: Discussion[];
  onDelete: () => void;
}

export function DiscussionList({ discussions, onDelete }: DiscussionListProps) {
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<string | null>(null);

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
  };

  const handleContinue = (discussionId: string) => {
    router.push(`/?discussionId=${discussionId}`);
  };

  const handleDeleteClick = (discussionId: string) => {
    setDeleteDialogOpen(discussionId);
  };

  const handleDeleteConfirmed = () => {
    onDelete();
    setDeleteDialogOpen(null);
  };

  if (discussions.length === 0) {
    return (
      <div className="text-center py-12">
        <MessageSquare className="w-16 h-16 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400 text-lg mb-2">No discussions yet</p>
        <p className="text-gray-500 text-sm">Start a new discussion to see it here</p>
      </div>
    );
  }

  const discussionToDelete = deleteDialogOpen
    ? discussions.find((d) => d.id === deleteDialogOpen)
    : null;

  return (
    <>
      <div className="space-y-3">
        {discussions.map((discussion) => (
          <div
            key={discussion.id}
            className="bg-black border-2 border-green-500 rounded-lg p-4 hover:border-green-400 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 mb-2">
                  <MessageSquare className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  <h3 className="text-white font-semibold text-lg truncate">
                    {discussion.topic}
                  </h3>
                </div>

                <div className="flex items-center gap-4 text-sm text-gray-400 ml-7">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    <span>{formatDate(discussion.updated_at)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {discussion.is_resolved ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <span className="text-green-500">Resolved</span>
                      </>
                    ) : (
                      <>
                        <Circle className="w-4 h-4 text-yellow-500" />
                        <span className="text-yellow-500">Active</span>
                      </>
                    )}
                  </div>
                  {discussion.current_turn > 0 && (
                    <span className="text-gray-500">
                      {Math.ceil(discussion.current_turn / 3)} round{discussion.current_turn / 3 !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleContinue(discussion.id)}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors text-sm font-medium"
                >
                  Continue
                </button>
                <button
                  onClick={() => handleDeleteClick(discussion.id)}
                  className="p-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded transition-colors border border-red-600/30"
                  title="Delete discussion"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {discussionToDelete && (
        <DeleteConfirmationDialog
          discussionId={discussionToDelete.id}
          topic={discussionToDelete.topic}
          isOpen={deleteDialogOpen === discussionToDelete.id}
          onClose={() => setDeleteDialogOpen(null)}
          onDeleted={handleDeleteConfirmed}
        />
      )}
    </>
  );
}
