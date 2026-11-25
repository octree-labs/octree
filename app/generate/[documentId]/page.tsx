import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { GenerateSessionContent } from '@/components/generate/GenerateSessionContent';
import type { GeneratedDocument } from '@/stores/generate';

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

  // The jsonb columns (attachments, message_history, ...) are typed as Json by
  // the generated types; the store's shape is what the app writes.
  return <GenerateSessionContent initialDocument={document as unknown as GeneratedDocument} />;
}
