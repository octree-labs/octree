import { skeleton as template1Skeleton } from './templates/template1';

// Skeletons are resumake.io v2 templates rendered with sample data. They're
// kept as strings so they ship with the serverless bundle.
export type ResumeTemplate = {
  id: string;
  name: string;
  engine: 'pdflatex' | 'xelatex';
  skeleton: string;
};

export const RESUME_TEMPLATES: Record<string, ResumeTemplate> = {
  template1: {
    id: 'template1',
    name: 'Classic',
    engine: 'pdflatex',
    skeleton: template1Skeleton,
  },
};

export const DEFAULT_RESUME_TEMPLATE_ID = 'template1';

export function getResumeTemplate(id: string): ResumeTemplate {
  const template = RESUME_TEMPLATES[id];
  if (!template) {
    throw new Error(
      `Unknown template "${id}". Available: ${Object.keys(RESUME_TEMPLATES).join(', ')}`
    );
  }
  return template;
}
