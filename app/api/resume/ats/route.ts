import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasUnlimitedEdits } from '@/lib/paywall';
import { isProEntitled } from '@/lib/subscription/entitlement';
import {
  analyzeResume,
  AtsInputError,
  MAX_JOB_DESCRIPTION_CHARS,
} from '@/lib/resume/ats/analyze';
import type { Json, TablesInsert } from '@/database.types';
import type { AtsSavedReport } from '@/types/resume';

export const runtime = 'nodejs';
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEX_BYTES = 200 * 1024;
// Vercel caps request bodies at 4.5 MB; a compiled resume is far smaller.
const MAX_PDF_BYTES = 3 * 1024 * 1024;

/**
 * POST /api/resume/ats - ATS analysis of a resume project, Pro only.
 *
 * Body: { projectId, tex, pdf (base64 of the compiled PDF), jobDescription? }.
 * The editor sends what it last compiled, so the report matches what the
 * user sees. The report is saved as the project's latest
 * (resume_ats_reports) and returned as an AtsSavedReport.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const { projectId, tex, pdf, jobDescription } = (body ?? {}) as Record<string, unknown>;
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid project' }, { status: 400 });
  }
  if (typeof tex !== 'string' || !tex.trim() || Buffer.byteLength(tex, 'utf8') > MAX_TEX_BYTES) {
    return NextResponse.json({ error: 'Invalid LaTeX source' }, { status: 400 });
  }
  if (typeof pdf !== 'string' || !pdf) {
    return NextResponse.json({ error: 'Compile the resume first' }, { status: 400 });
  }
  if (
    jobDescription != null &&
    (typeof jobDescription !== 'string' || jobDescription.length > MAX_JOB_DESCRIPTION_CHARS)
  ) {
    return NextResponse.json(
      { error: `The job description must be under ${MAX_JOB_DESCRIPTION_CHARS.toLocaleString('en-US')} characters` },
      { status: 400 }
    );
  }

  const pdfBytes = new Uint8Array(Buffer.from(pdf, 'base64'));
  if (pdfBytes.byteLength > MAX_PDF_BYTES || Buffer.from(pdfBytes.subarray(0, 5)).toString() !== '%PDF-') {
    return NextResponse.json({ error: 'Invalid PDF' }, { status: 400 });
  }

  const hasUnlimited = hasUnlimitedEdits(user.email);
  if (!hasUnlimited) {
    const { data: row } = await supabase
      .from('user_usage')
      .select('is_pro, subscription_status, stripe_subscription_id, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!isProEntitled({ row, hasUnlimited })) {
      return NextResponse.json(
        { error: 'ATS analysis is a Pro feature', upgradeRequired: true },
        { status: 403 }
      );
    }
  }

  const { data } = await supabase
    .from('projects')
    .select('id, kind')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();
  const project = data as { id: string; kind: string | null } | null;
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  if (project.kind !== 'resume') {
    return NextResponse.json({ error: 'ATS analysis is only available for resume projects' }, { status: 400 });
  }

  const job = typeof jobDescription === 'string' && jobDescription.trim() ? jobDescription.trim() : null;
  try {
    const report = await analyzeResume({ tex, pdf: pdfBytes, jobDescription: job });
    const saved: AtsSavedReport = {
      report,
      jobDescription: job,
      texHash: createHash('sha256').update(tex, 'utf8').digest('hex'),
      analyzedAt: new Date().toISOString(),
    };

    // The report is already paid for; a failed save only costs the reload.
    const row: TablesInsert<'resume_ats_reports'> = {
      project_id: projectId,
      user_id: user.id,
      report: report as unknown as Json,
      job_description: saved.jobDescription,
      tex_hash: saved.texHash,
      updated_at: saved.analyzedAt,
    };
    const { error: saveError } = await (
      supabase.from('resume_ats_reports') as ReturnType<typeof supabase.from>
    ).upsert(row, { onConflict: 'project_id' });
    if (saveError) console.error('Failed to save ATS report:', saveError);

    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof AtsInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('ATS analysis failed:', error);
    return NextResponse.json({ error: 'The analysis failed. Please try again.' }, { status: 500 });
  }
}
