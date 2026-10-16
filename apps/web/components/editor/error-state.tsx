'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  error: string;
}

export function ErrorState({ error }: ErrorStateProps) {
  const router = useRouter();

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="text-center">
        <p className="mb-4 text-neutral-600">{error}</p>
        <Button variant="outline" onClick={() => router.push('/')}>
          Back to Projects
        </Button>
      </div>
    </main>
  );
}
