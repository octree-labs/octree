import { cn } from '@/lib/utils';

interface SettingsCardProps {
  title: string;
  /** Shown next to the title, e.g. a status badge. */
  badge?: React.ReactNode;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/** A bordered settings section: header (title, description, actions) over rows. */
export function SettingsCard({
  title,
  badge,
  description,
  action,
  className,
  children,
}: SettingsCardProps) {
  return (
    <section className={cn('rounded-xl border border-neutral-200 bg-white', className)}>
      <div
        className={cn(
          'flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between',
          children && 'border-b border-neutral-200'
        )}
      >
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
            {badge}
          </div>
          {description && (
            <p className="mt-0.5 text-sm text-neutral-500">{description}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 gap-2">{action}</div>}
      </div>
      {children && <div className="divide-y divide-neutral-200">{children}</div>}
    </section>
  );
}

interface SettingsRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

/** One label/value row inside a SettingsCard. */
export function SettingsRow({ label, description, children }: SettingsRowProps) {
  return (
    <div className="grid gap-2 px-6 py-4 sm:grid-cols-3 sm:items-center sm:gap-6">
      <div>
        <p className="text-sm font-medium text-neutral-700">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
        )}
      </div>
      <div className="min-w-0 text-sm text-neutral-900 sm:col-span-2">{children}</div>
    </div>
  );
}
