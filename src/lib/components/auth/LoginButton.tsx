'use client';

import { useRouter } from 'next/navigation';
import { History } from 'lucide-react';

interface LoginButtonProps {
  showPastDiscussions?: boolean;
}

export function LoginButton({ showPastDiscussions = false }: LoginButtonProps) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-2">
      {showPastDiscussions && (
        <button
          onClick={() => router.push('/discussions')}
          className="flex items-center gap-1.5 px-2 py-1 bg-gray-800/80 hover:bg-gray-700/90 backdrop-blur-sm text-white rounded-lg transition-all duration-200 border border-gray-700/50 hover:border-gray-600/50 shadow-lg hover:shadow-xl"
        >
          <History className="w-3 h-3" />
          <span className="text-xs font-medium">Discussions</span>
        </button>
      )}
      <button
        onClick={() => router.push('/auth/signin')}
        className="px-2 py-1 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white rounded-lg transition-all duration-200 shadow-lg hover:shadow-green-500/50 hover:scale-105 active:scale-95 font-medium text-xs"
      >
        Sign In
      </button>
    </div>
  );
}
