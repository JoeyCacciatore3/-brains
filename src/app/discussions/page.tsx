'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Brain, ArrowLeft, Loader2 } from 'lucide-react';
import { DiscussionList } from '@/lib/components/discussions/DiscussionList';
import { LoginButton } from '@/lib/components/auth/LoginButton';
import type { Discussion } from '@/lib/db/discussions';

export default function DiscussionsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'unauthenticated') {
      // Allow viewing but show login prompt
      setIsLoading(false);
      return;
    }

    // Fetch discussions
    const fetchDiscussions = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch('/api/discussions');

        if (!response.ok) {
          if (response.status === 401) {
            setError('Please sign in to view your discussions');
            return;
          }
          throw new Error('Failed to fetch discussions');
        }

        const data = await response.json();
        setDiscussions(data.discussions || []);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load discussions';
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDiscussions();
  }, [status]);

  const handleDelete = () => {
    // Refetch discussions after delete
    if (session?.user) {
      fetch('/api/discussions')
        .then((res) => res.json())
        .then((data) => {
          setDiscussions(data.discussions || []);
        })
        .catch(() => {
          // Silently fail, user can refresh
        });
    }
  };

  return (
    <div className="min-h-screen bg-black p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8 border-b-2 border-green-500 pb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/')}
                className="p-2 hover:bg-gray-800 rounded transition-colors"
                title="Back to home"
              >
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>
              <Brain className="w-8 h-8 text-green-500" />
              <h1 className="text-3xl font-bold text-white">Past Discussions</h1>
            </div>
            {!session?.user && (
              <LoginButton />
            )}
          </div>
          <p className="text-gray-400">
            View, continue, or delete your previous discussions
          </p>
        </div>

        {/* Content */}
        {status === 'loading' || isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
            <span className="ml-3 text-white">Loading discussions...</span>
          </div>
        ) : error ? (
          <div className="bg-red-500/20 border-2 border-red-500 rounded-lg p-6 text-center">
            <p className="text-red-400 mb-4">{error}</p>
            {!session?.user && <LoginButton />}
          </div>
        ) : !session?.user ? (
          <div className="bg-yellow-500/20 border-2 border-yellow-500 rounded-lg p-6 text-center">
            <p className="text-yellow-400 mb-4">
              Please sign in to view your discussions
            </p>
            <LoginButton />
          </div>
        ) : (
          <DiscussionList discussions={discussions} onDelete={handleDelete} />
        )}
      </div>
    </div>
  );
}
