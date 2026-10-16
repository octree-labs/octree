import { Check, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

const FEATURES: { text: string; info?: string[] }[] = [
  {
    text: 'AI writes and edits LaTeX, just describe what you want',
    info: [
      'Generate entire sections from a prompt',
      'Rewrite or restructure existing content',
      'No LaTeX knowledge required',
    ],
  },
  {
    text: 'Fast PDF preview and compilation',
    info: [
      'Compile and see your PDF in seconds',
      'Auto-compiles after AI edits document',
    ],
  },
  {
    text: 'Unlimited projects and files',
  },
  {
    text: 'AI catches errors before you do and suggests fixes',
    info: [
      'Detects compilation errors and missing packages',
      'Spots and highlights formatting issues',
      'Apply suggested fixes with one click',
    ],
  },
  {
    text: 'AI finds and inserts relevant citations from your references',
    info: [
      'Semantically search your references',
      'Insert the right citations as you write',
    ],
  },
  {
    text: 'Access your work from any device',
  },
];

export function FeatureList() {
  return (
    <div className="space-y-3">
      {FEATURES.map((feature, index) => (
        <div key={index} className="flex gap-3">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm leading-5 text-muted-foreground">
            {feature.text}
            {feature.info && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="mb-px ml-1 inline h-3.5 w-3.5 align-text-bottom text-muted-foreground/50 hover:text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6} className="max-w-[250px] bg-white text-foreground shadow-md border border-border/50 [&_.fill-primary]:!hidden">
                  <ul className="list-disc pl-3 space-y-0.5">
                    {feature.info.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
