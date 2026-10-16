'use client';

import { Loader2 } from 'lucide-react';

export function LoadingState() {
  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    </main>
  );
}
