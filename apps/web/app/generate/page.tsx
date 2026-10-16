import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserWalkthroughStatus } from '@/actions/get-walkthrough';
import { GeneratePageContent } from '@/components/generate/GeneratePageContent';

export default async function GeneratePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  const walkthroughStatus = await getUserWalkthroughStatus(user.id);
  const shouldShowGenerateWalkthrough = !walkthroughStatus?.generate_seen;

  return (
    <GeneratePageContent
      userId={user.id}
      shouldShowGenerateWalkthrough={shouldShowGenerateWalkthrough}
    />
  );
}
