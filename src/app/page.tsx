'use client';

import { Suspense } from 'react';
import { DialogueHero } from '@/lib/components/dialogue/DialogueHero';

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4"></div>
        <p className="text-white">Loading AI Dialogue Platform...</p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen">
      <Suspense fallback={<LoadingFallback />}>
        <DialogueHero />
      </Suspense>
    </div>
  );
}
