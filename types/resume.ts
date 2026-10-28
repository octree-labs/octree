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

// --- ATS analysis (lib/resume/ats) -------------------------------------------

export type AtsCheckStatus = 'pass' | 'warn' | 'fail';

/** A deterministic check on the text an ATS would extract from the PDF. */
export type AtsCheck = {
  id: string;
  category: 'contact' | 'sections' | 'parsing' | 'length';
  status: AtsCheckStatus;
  title: string;
  detail: string;
};

/** A content issue from the AI review. `fix` is present only when it can be applied verbatim to the LaTeX. */
export type AtsIssue = {
  id: string;
  category: 'impact' | 'clarity' | 'consistency' | 'length';
  severity: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  fix?: { find: string; replace: string };
};

export type AtsKeyword = {
  keyword: string;
  importance: 'required' | 'preferred';
  matched: boolean;
  /** The spelling found in the resume when it matched through an alias. */
  matchedAs?: string;
};

export type AtsJobMatch = {
  /** 0-100, required keywords weigh twice as much as preferred ones. */
  score: number;
  keywords: AtsKeyword[];
};

export type AtsReport = {
  /** 0-100. */
  score: number;
  scores: { parsing: number; content: number; jobMatch: number | null };
  checks: AtsCheck[];
  issues: AtsIssue[];
  jobMatch: AtsJobMatch | null;
};

/** A saved analysis (resume_ats_reports), as the editor's ATS tab uses it. */
export type AtsSavedReport = {
  report: AtsReport;
  jobDescription: string | null;
  /** SHA-256 (hex) of the LaTeX analyzed; differs from the current source when the report is outdated. */
  texHash: string;
  analyzedAt: string;
};
