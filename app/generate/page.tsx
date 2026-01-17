import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { GeneratePageContent } from '@/components/generate/GeneratePageContent';
import Navbar from '@/components/navbar';

export default async function GeneratePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  const userName = user?.user_metadata?.name ?? user?.email ?? null;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <div className="h-14 shrink-0">
        <Navbar userName={userName} />
      </div>
      <main className="min-h-0 flex-1">
        <GeneratePageContent />
      </main>
    </div>
  );
}
