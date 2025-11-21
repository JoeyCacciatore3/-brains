'use client';

import { signIn } from 'next-auth/react';
import { LogIn } from 'lucide-react';

export function LoginButton() {
  return (
    <button
      onClick={() => signIn()}
      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
    >
      <LogIn className="w-4 h-4" />
      <span>Sign In</span>
    </button>
  );
}
