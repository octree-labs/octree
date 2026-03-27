import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { normalizeGeneratedDocument } from '@/lib/generate/document';
import { GeneratePageContent } from '@/components/generate/GeneratePageContent';

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

  return (
    <GeneratePageContent
      userId={user.id}
      initialDocument={normalizeGeneratedDocument(document)}
    />
  );
}
