import Link from 'next/link';

export default function UnsubscribedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Unsubscribed</h1>
        <p className="text-muted-foreground">
          You've been removed from our email list.
        </p>
        <Link
          href="/"
          className="block pt-2 text-sm underline underline-offset-4"
        >
          Back to Octree
        </Link>
      </div>
    </div>
  );
}
