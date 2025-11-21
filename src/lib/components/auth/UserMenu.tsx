'use client';

import { signOut, useSession } from 'next-auth/react';
import { LogOut, User } from 'lucide-react';
import { useState } from 'react';
import Image from 'next/image';

export function UserMenu() {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);

  if (!session?.user) {
    return null;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
      >
        {session.user.image ? (
          <Image
            src={session.user.image}
            alt={session.user.name || 'User'}
            width={24}
            height={24}
            className="w-6 h-6 rounded-full"
          />
        ) : (
          <User className="w-5 h-5" />
        )}
        <span className="hidden sm:inline">{session.user.name || session.user.email}</span>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 mt-2 w-48 bg-gray-800 rounded-lg shadow-lg z-20 border border-gray-700">
            <div className="p-2">
              <div className="px-3 py-2 text-sm text-gray-300 border-b border-gray-700">
                <div className="font-medium">{session.user.name || 'User'}</div>
                <div className="text-xs text-gray-400">{session.user.email}</div>
              </div>
              <button
                onClick={() => {
                  setIsOpen(false);
                  signOut();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
