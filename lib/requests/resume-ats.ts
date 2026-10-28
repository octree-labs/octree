import { createClient } from '@/lib/supabase/client';
import type { AtsReport, AtsSavedReport } from '@/types/resume';

/** A failed analysis; `upgradeRequired` when the server says the user is not Pro. */
export class AtsRequestError extends Error {
  constructor(
    message: string,
    readonly upgradeRequired = false
  ) {
    super(message);
  }
}

/** The project's latest saved analysis, or null when there is none (or the table is not there yet). */
export async function getAtsReport(projectId: string): Promise<AtsSavedReport | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('resume_ats_reports')
    .select('report, job_description, tex_hash, updated_at')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) {
    console.error('Failed to load the ATS report:', error);
    return null;
  }
  const row = data as {
    report: AtsReport;
    job_description: string | null;
    tex_hash: string;
    updated_at: string;
  } | null;
  if (!row) return null;
  return {
    report: row.report,
    jobDescription: row.job_description,
    texHash: row.tex_hash,
    analyzedAt: row.updated_at,
  };
}

export async function runAtsAnalysis(input: {
  projectId: string;
  tex: string;
  /** Base64 of the compiled PDF. */
  pdf: string;
  jobDescription: string | null;
}): Promise<AtsSavedReport> {
  const response = await fetch('/api/resume/ats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AtsRequestError(
      data.error || 'The analysis failed. Please try again.',
      Boolean(data.upgradeRequired)
    );
  }
  return data as AtsSavedReport;
}

/** SHA-256 (hex) of the source, the same hash the route stores as tex_hash. */
export async function hashTex(tex: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tex));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
