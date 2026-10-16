import React from 'react';
import { cn } from '@/lib/utils';

interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: 'default' | 'outline' | 'ghost';
}

export function ButtonGroup({
  children,
  className,
  variant = 'outline',
  ...props
}: ButtonGroupProps) {
  const childrenArray = React.Children.toArray(children);

  return (
    <div
      className={cn(
        'bg-background inline-flex rounded-md shadow-xs',
        className
      )}
      {...props}
    >
      {childrenArray.map((child, index) => (
        <React.Fragment key={index}>{child}</React.Fragment>
      ))}
    </div>
  );
}

interface ButtonGroupItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export function ButtonGroupItem({
  children,
  className,
  ...props
}: ButtonGroupItemProps) {
  return (
    <button
      className={cn(
        'hover:bg-accent border border-l-0 border-slate-300 px-3.5 py-1.5 text-sm font-medium first:rounded-l-md first:border-l last:rounded-r-md focus:ring focus:ring-gray-300 focus:outline-none focus:ring-inset',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
