import { LoginForm } from '@/components/auth/login-form';
import { AuthMarketingSection } from '@/components/auth/auth-marketing-section';
import { OctreeLogo } from '@/components/icons/octree-logo';

export default async function Page({ searchParams }: { searchParams?: Promise<{ next?: string }> }) {
  const params = (await searchParams) ?? {};
  const raw = params.next ?? '/';
  const next = typeof raw === 'string' && raw.startsWith('/') ? raw : '/';
  
  return (
    <div className="flex min-h-screen w-full">
      <div className="relative flex w-full flex-col p-6 lg:w-1/2">
        <div className="absolute top-8 left-8 flex items-center gap-2">
          <OctreeLogo className="h-6 w-6" />
          <span className="text-lg font-medium tracking-tight text-neutral-900">
            Octree
          </span>
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
