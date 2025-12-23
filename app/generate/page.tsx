import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/requests/user';
import { GenerateChat } from '@/components/generate/GenerateChat';
import Navbar from '@/components/navbar';

export default async function GeneratePage() {
    const user = await getCurrentUser();

    if (!user) {
        redirect('/auth/login');
    }

    const userName = user?.user_metadata?.name ?? user?.email ?? null;

    return (
        <>
            <Navbar userName={userName} />

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

