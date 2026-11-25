import { SignUpForm } from '@/components/auth/signup-form';
import { AuthMarketingSection } from '@/components/auth/auth-marketing-section';
import { OctreeLogo, OctreeWordmark } from '@/components/icons/octree-logo';
import { safeRedirectPath } from '@/lib/auth/redirect';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const nextPath = safeRedirectPath(params.next);

  return (
    <div className="flex min-h-screen w-full">
      <div className="flex w-full flex-col p-6 lg:w-1/2">
        <div className="mb-8 flex items-center gap-2">
          <OctreeLogo className="h-6 w-6" />
          <OctreeWordmark className="text-lg" />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <SignUpForm onboardingRedirect="/onboarding" nextPath={nextPath} />
          </div>
        </div>
      </div>

      <AuthMarketingSection />
    </div>
  );
}
