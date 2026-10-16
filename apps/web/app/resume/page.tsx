import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/actions/get-user';
import Navbar from '@/components/navbar';
import { ResumeReviewScreen } from '@/components/resume/resume-review-screen';

export default async function ResumePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/auth/login?next=/resume');
  }

  const userName = user.user_metadata?.name ?? user.email ?? null;

  return (
    <>
      <Navbar userName={userName} />
      <main className="container mx-auto min-h-0 px-4 py-8">
        <ResumeReviewScreen />
      </main>
    </>
  );
}
