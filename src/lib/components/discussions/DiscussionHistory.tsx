'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { History, FileText } from 'lucide-react';
import type { Discussion } from '@/lib/db/discussions';

export function DiscussionHistory() {
  const { data: session } = useSession();
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }

    const fetchDiscussions = async () => {
      try {
        const response = await fetch('/api/discussions');
        if (!response.ok) {
          throw new Error('Failed to fetch discussions');
        }
        const data = await response.json();
        setDiscussions(data.discussions || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load discussions');
      } finally {
        setLoading(false);
      }
    };

    fetchDiscussions();
  }, [session]);

  if (!session) {
    return (
      <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
        <p className="text-gray-300 text-center">Please sign in to view your discussion history</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
        <p className="text-gray-300 text-center">Loading discussions...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
        <p className="text-red-300 text-center">{error}</p>
      </div>
    );
  }

  if (discussions.length === 0) {
    return (
      <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-5 h-5 text-gray-300" />
          <h2 className="text-xl font-semibold text-white">Discussion History</h2>
        </div>
        <p className="text-gray-300 text-center">
          No discussions yet. Start a new discussion to see it here!
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
      <div className="flex items-center gap-2 mb-4">
        <History className="w-5 h-5 text-gray-300" />
        <h2 className="text-xl font-semibold text-white">Discussion History</h2>
      </div>
      <div className="space-y-3">
        {discussions.map((discussion) => (
          <div
            key={discussion.id}
            className="bg-white/5 p-4 rounded-lg border border-white/10 hover:bg-white/10 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-white font-medium mb-1">{discussion.topic}</h3>
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  <span>{new Date(discussion.created_at).toLocaleDateString()}</span>
                  {discussion.is_resolved ? (
                    <span className="text-green-400">Resolved</span>
                  ) : (
                    <span className="text-yellow-400">Active</span>
                  )}
                </div>
              </div>
              <FileText className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
