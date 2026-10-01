// Client-safe template metadata for the picker (the LaTeX skeletons stay server-side
// in ./templates). Thumbnails are rendered from the sample PDFs in public/.
export type ResumeTemplateOption = {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
};

export const RESUME_TEMPLATE_OPTIONS: ResumeTemplateOption[] = [
  {
    id: 'template1',
    name: 'Classic',
    description: 'Traditional serif, single column',
    thumbnail: '/resume-templates/template1.png',
  },
  {
    id: 'template6',
    name: 'Minimal',
    description: 'Clean sans-serif headings, lots of space',
    thumbnail: '/resume-templates/template6.png',
  },
];

export const DEFAULT_RESUME_TEMPLATE_ID = RESUME_TEMPLATE_OPTIONS[0].id;
