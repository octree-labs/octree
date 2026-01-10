import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/requests/user';
import { GeneratePageContent } from '@/components/generate/GeneratePageContent';
import Navbar from '@/components/navbar';

export default async function GeneratePage() {
    const user = await getCurrentUser();

    if (!user) {
        redirect('/auth/login');
    }

    const userName = user?.user_metadata?.name ?? user?.email ?? null;

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden">
            <div className="h-14 shrink-0">
                <Navbar userName={userName} />
            </div>
            <main className="min-h-0 flex-1">
                <GeneratePageContent />
            </main>
        </div>
    );
}

