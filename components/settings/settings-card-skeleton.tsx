import { Skeleton } from '@/components/ui/skeleton';

/** Placeholder with the shape of a SettingsCard while its data loads. */
export function SettingsCardSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="space-y-2 border-b border-neutral-200 px-6 py-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="divide-y divide-neutral-200">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="grid gap-2 px-6 py-4 sm:grid-cols-3 sm:items-center sm:gap-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-48 sm:col-span-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
