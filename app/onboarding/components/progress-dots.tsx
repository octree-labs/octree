import { cn } from '@/lib/utils';

interface ProgressDotsProps {
  currentStep: number;
  totalSteps: number;
}

export function ProgressDots({ currentStep, totalSteps }: ProgressDotsProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 w-1.5 rounded-full transition-all duration-300',
            i === currentStep
              ? 'bg-primary'
              : i < currentStep
                ? 'bg-primary/60'
                : 'bg-muted-foreground/20'
          )}
        />
      ))}
    </div>
  );
}
