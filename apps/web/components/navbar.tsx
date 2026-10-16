import Link from 'next/link';
import { OctreeLogo, OctreeWordmark } from '@/components/icons/octree-logo';
import { UserProfileDropdown } from '@/components/user/user-profile-dropdown';

type NavbarProps = {
  userName: string | null;
};

export default function Navbar({ userName }: NavbarProps) {
  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="container mx-auto px-4">
        <div className="flex h-14 items-center justify-between">
          <div className="flex items-center">
            <Link href="/" className="flex items-center space-x-2">
              <OctreeLogo className="h-7 w-7" />
              <OctreeWordmark className="text-lg" />
            </Link>
          </div>
          <div className="flex items-center">
            <UserProfileDropdown userName={userName} />
          </div>
        </div>
      </div>
    </nav>
  );
}
