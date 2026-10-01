'use client';

import { Check } from 'lucide-react';
import { RESUME_TEMPLATE_OPTIONS } from '@/lib/resume/template-options';
import { cn } from '@/lib/utils';

export function TemplatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="radiogroup" className="grid grid-cols-2 gap-4">
      {RESUME_TEMPLATE_OPTIONS.map((template) => {
        const selected = template.id === value;
        return (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(template.id)}
            className={cn(
              'group rounded-xl border p-1.5 text-left transition-colors',
              selected
                ? 'border-primary ring-2 ring-primary/20'
                : 'border-neutral-200 hover:border-neutral-300'
            )}
          >
            <div className="relative aspect-[4/5] overflow-hidden rounded-md border border-neutral-100 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={template.thumbnail}
                alt={`${template.name} template preview`}
                className="h-full w-full object-cover object-top"
              />
              {selected && (
                <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" />
                </span>
              )}
            </div>
            <p className="mt-2 px-1 text-sm font-medium text-neutral-900">{template.name}</p>
            <p className="px-1 pb-1 text-xs text-neutral-500">{template.description}</p>
          </button>
        );
      })}
    </div>
  );
}
