export type ResumeSuggestion = {
  id: string;
  category: 'typo' | 'consistency' | 'misplaced' | 'grammar';
  title: string;
  reason: string;
  find: string;
  replace: string;
};

export type CoverageReport = {
  coverage: number;
  missing: string[];
  added: string[];
};

export type RedesignStep =
  | 'reading'
  | 'writing'
  | 'compiling'
  | 'fixing'
  | 'checking'
  | 'suggesting';

export type RedesignProgressEvent = {
  step: RedesignStep;
  attempt?: number;
};

export type RedesignResultEvent = {
  tex: string;
  pdf: string; // base64
  coverage: CoverageReport;
  suggestions: ResumeSuggestion[];
};
