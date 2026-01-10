import { Check } from 'lucide-react';

const FEATURES = [
  'AI-powered LaTeX editing and suggestions',
  'Real-time PDF preview and compilation',
  'Unlimited projects and files',
  'Version control and collaboration',
  'Smart chat assistance for LaTeX',
  'Cloud sync across all your devices',
];

export function FeatureList() {
  return (
    <div className="space-y-3">
      {FEATURES.map((feature, index) => (
        <div key={index} className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <Check className="h-5 w-5 text-muted-foreground" />
          </div>
          <span className="text-sm text-muted-foreground">{feature}</span>
        </div>
      ))}
    </div>
  );
}
