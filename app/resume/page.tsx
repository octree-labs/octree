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

  // Full-height on desktop: the review panes fill the screen under the navbar.
  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <Navbar userName={userName} />
      <main className="flex min-h-0 flex-1 flex-col">
        <ResumeReviewScreen />
      </main>
    </div>
  );
}
