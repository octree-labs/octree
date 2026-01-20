import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { GeneratePageContent } from '@/components/generate/GeneratePageContent';

export default async function GeneratePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  return <GeneratePageContent />;
}
