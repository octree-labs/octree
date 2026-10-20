'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface SettingsTabsProps {
  items: { href: string; title: string }[];
}

export function SettingsTabs({ items }: SettingsTabsProps) {
  const pathname = usePathname();
  // The clicked tab, highlighted while its page loads (the pathname only
  // changes once the navigation commits).
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => setPendingHref(null), [pathname]);
  const activeHref = pendingHref ?? pathname;

  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1">
      {items.map((item) => {
        const isActive = activeHref === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setPendingHref(item.href)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-neutral-100 text-neutral-900'
                : 'text-neutral-500 hover:text-neutral-900'
            )}
          >
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
