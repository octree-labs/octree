import { skeleton as template1Skeleton } from './templates/template1';
import { skeleton as template6Skeleton } from './templates/template6';
import { DEFAULT_RESUME_TEMPLATE_ID, RESUME_TEMPLATE_OPTIONS } from './template-options';

export { DEFAULT_RESUME_TEMPLATE_ID };

// Skeletons are resumake.io v2 templates rendered with sample data. They're
// kept as strings so they ship with the serverless bundle.
export type ResumeTemplate = {
  id: string;
  name: string;
  engine: 'pdflatex' | 'xelatex';
  skeleton: string;
};

const SOURCES: Record<string, Pick<ResumeTemplate, 'engine' | 'skeleton'>> = {
  template1: { engine: 'pdflatex', skeleton: template1Skeleton },
  template6: { engine: 'xelatex', skeleton: template6Skeleton },
};

export const RESUME_TEMPLATES: Record<string, ResumeTemplate> = Object.fromEntries(
  RESUME_TEMPLATE_OPTIONS.map(({ id, name }) => [id, { id, name, ...SOURCES[id] }])
);

export function getResumeTemplate(id: string): ResumeTemplate {
  const template = RESUME_TEMPLATES[id];
  if (!template) {
    throw new Error(
      `Unknown template "${id}". Available: ${Object.keys(RESUME_TEMPLATES).join(', ')}`
    );
  }
  return template;
}
