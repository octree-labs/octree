import { SignUpForm } from '@/components/auth/signup-form';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const nextPath = typeof params.next === 'string' ? params.next : null;

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <SignUpForm onboardingRedirect="/onboarding" nextPath={nextPath} />
      </div>
    </div>
  );
}
