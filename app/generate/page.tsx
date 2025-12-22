import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/requests/user';
import { UserProfileDropdown } from '@/components/user/user-profile-dropdown';
import { GenerateChat } from '@/components/generate/GenerateChat';
import { DM_Sans } from 'next/font/google';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { FileText, Sparkles } from 'lucide-react';

const dmSans = DM_Sans({
    subsets: ['latin'],
    weight: ['400', '500', '700'],
});

export default async function GeneratePage() {
    const user = await getCurrentUser();

    if (!user) {
        redirect('/auth/login');
    }

    const userName = user?.user_metadata?.name ?? user?.email ?? null;

    return (
        <>
            <nav className="border-b border-gray-200 bg-white">
                <div className="mx-auto w-full max-w-4xl px-6">
                    <div className="flex h-14 items-center justify-between">
                        <div className="flex items-center">
                            <Link href="/" className="flex items-center space-x-2">
                                <div className="flex h-5 w-5 items-center justify-center rounded bg-blue-500">
                                    <FileText className="h-3 w-3 text-white" />
                                </div>
                                <span
                                    className={cn(
                                        'text-lg font-medium tracking-tight text-neutral-900',
                                        dmSans.className
                                    )}
                                >
                                    Octree
                                </span>
                            </Link>
                        </div>
                        <div className="flex items-center">
                            <UserProfileDropdown userName={userName} />
                        </div>
                    </div>
                </div>
            </nav>

            <main className="mx-auto w-full max-w-4xl px-6 py-8">
                <div className="mb-6">
                    <h1 className="text-lg font-semibold text-neutral-900">
                        AI Research Generator
                    </h1>
                    <p className="text-sm text-neutral-500">
                        Enter a research topic and let AI generate a complete paper with experiments
                    </p>
                </div>

                <div className="h-[calc(100vh-220px)]">
                    <GenerateChat />
                </div>
            </main>
        </>
    );
}
