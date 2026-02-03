import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { GenerateSessionContent } from '@/components/generate/GenerateSessionContent';

interface PageProps {
  params: Promise<{ documentId: string }>;
}

export default async function GenerateSessionPage({ params }: PageProps) {
  const { documentId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/auth/login');
  }

  const { data: document } = await supabase
    .from('generated_documents')
    .select('*')
    .eq('id', documentId)
    .eq('user_id', user.id)
    .single();

  if (!document) {
    notFound();
  }

  return <GenerateSessionContent initialDocument={document} />;
}
