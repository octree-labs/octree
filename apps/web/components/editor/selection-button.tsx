'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

interface SelectionButtonProps {
  show: boolean;
  position: { top: number; left: number };
  onCopy: () => void;
  className?: string;
}

export function SelectionButton({
  show,
  position,
  onCopy,
  className = '',
}: SelectionButtonProps) {
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
  }, []);

  if (!show) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onCopy}
      className={cn('pointer-events-auto fixed z-50 font-medium', className)}
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      Edit
      <kbd className="ml-1 text-xs opacity-60">{isMac ? '⌘B' : 'Ctrl+B'}</kbd>
    </Button>
  );
}
