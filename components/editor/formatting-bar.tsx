'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type TextFormat = 'bold' | 'italic' | 'underline';

const FORMATS: { format: TextFormat; label: string; className: string }[] = [
  { format: 'bold', label: 'B', className: 'font-bold' },
  { format: 'italic', label: 'I', className: 'italic' },
  { format: 'underline', label: 'U', className: 'underline' },
];

export function FormattingBar({
  onTextFormat,
}: {
  onTextFormat: (format: TextFormat) => void;
}) {
  return (
    <ButtonGroup>
      {FORMATS.map(({ format, label, className }) => (
        <ButtonGroupItem
          key={format}
          onClick={() => onTextFormat(format)}
          className="w-8 px-2.5 py-1"
          title={format[0].toUpperCase() + format.slice(1)}
        >
          <span className={className}>{label}</span>
        </ButtonGroupItem>
      ))}
    </ButtonGroup>
  );
}
