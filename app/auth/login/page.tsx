import { LoginForm } from '@/components/auth/login-form';
import { AuthMarketingSection } from '@/components/auth/auth-marketing-section';
import { OctreeLogo, OctreeWordmark } from '@/components/icons/octree-logo';
import { safeRedirectPath } from '@/lib/auth/redirect';

export default async function Page({ searchParams }: { searchParams?: Promise<{ next?: string }> }) {
  const params = (await searchParams) ?? {};
  const next = safeRedirectPath(params.next) ?? '/';
  
  return (
    <div className="flex min-h-screen w-full">
      <div className="relative flex w-full flex-col p-6 lg:w-1/2">
        <div className="absolute top-8 left-8 flex items-center gap-2">
          <OctreeLogo className="h-6 w-6" />
          <OctreeWordmark className="text-lg" />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <LoginForm nextPath={next} />
          </div>
        </div>
      </div>

      <AuthMarketingSection />
    </div>
  );
}
