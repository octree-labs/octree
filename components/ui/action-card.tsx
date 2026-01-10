'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ActionCardProps {
    icon: ReactNode;
    title: string;
    description: string;
    onClick?: () => void;
    variant?: 'blue' | 'rose' | 'violet' | 'emerald';
    className?: string;
}

const variantStyles = {
    blue: {
        card: 'bg-sky-50/80 hover:bg-sky-100/80 border-sky-100 hover:border-sky-200',
        iconContainer: 'bg-sky-100 text-sky-600',
    },
    rose: {
        card: 'bg-rose-50/80 hover:bg-rose-100/80 border-rose-100 hover:border-rose-200',
        iconContainer: 'bg-rose-100 text-rose-600',
    },
    violet: {
        card: 'bg-violet-50/80 hover:bg-violet-100/80 border-violet-100 hover:border-violet-200',
        iconContainer: 'bg-violet-100 text-violet-600',
    },
    emerald: {
        card: 'bg-emerald-50/80 hover:bg-emerald-100/80 border-emerald-100 hover:border-emerald-200',
        iconContainer: 'bg-emerald-100 text-emerald-600',
    },
};

export function ActionCard({
    icon,
    title,
    description,
    onClick,
    variant = 'blue',
    className,
}: ActionCardProps) {
    const styles = variantStyles[variant];

    const Component = onClick ? 'button' : 'div';

    return (
        <Component
            type={onClick ? 'button' : undefined}
            onClick={onClick}
            className={cn(
                'group flex items-center gap-4 rounded-xl border px-5 py-4',
                'transition-all duration-200 ease-out',
                'text-left',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-500',
                onClick && 'cursor-pointer',
                styles.card,
                className
            )}
        >
            <div
                className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
                    'transition-transform duration-200',
                    styles.iconContainer
                )}
            >
                {icon}
            </div>
            <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-neutral-800">
                    {title}
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                    {description}
                </p>
            </div>
        </Component>
    );
}

