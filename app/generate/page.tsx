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
        <div className="relative h-screen w-screen overflow-hidden">
            <div className="fixed inset-x-0 top-0 z-50">
                <Navbar userName={userName} />
            </div>
            <main className="absolute inset-x-0 bottom-0 top-14 overflow-hidden">
                <GeneratePageContent />
            </main>
        </div>
    );
}

