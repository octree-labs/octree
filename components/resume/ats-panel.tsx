'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Loader2,
  MessageSquare,
  RefreshCw,
  ScanSearch,
  TriangleAlert,
  Undo2,
  WandSparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSubscriptionUsage } from '@/hooks/use-subscription-usage';
import { AtsRequestError, getAtsReport, hashTex, runAtsAnalysis } from '@/lib/requests/resume-ats';
import { fixState, undoFix } from '@/lib/resume/ats/fix-state';
import { canUseFeature } from '@/lib/subscription/features';
import { cn } from '@/lib/utils';
import { PaywallActions } from '@/stores/paywall';
import type { AtsCheck, AtsIssue, AtsKeyword, AtsReport, AtsSavedReport } from '@/types/resume';

const MAX_JOB_DESCRIPTION_CHARS = 20_000;

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "5 minutes ago", "yesterday", "just now". */
function timeAgo(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  for (const [unit, ms] of UNITS) {
    if (elapsed >= ms) return RELATIVE.format(-Math.floor(elapsed / ms), unit);
  }
  return 'just now';
}

// Brand-blue bars, neutral keywords; the verdict badge is the only signal color.
function scoreTone(score: number) {
  if (score >= 80) return { badge: 'bg-green-50 text-green-700 ring-green-600/20', label: 'Strong' };
  if (score >= 60) return { badge: 'bg-amber-50 text-amber-700 ring-amber-600/20', label: 'Needs work' };
  return { badge: 'bg-red-50 text-red-700 ring-red-600/20', label: 'Weak' };
}

function ScoreBar({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-medium text-slate-900">{score === null ? '—' : score}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        {score !== null && (
          <div className="h-full rounded-full bg-primary/70" style={{ width: `${score}%` }} />
        )}
      </div>
    </div>
  );
}

function ScoreCard({ report }: { report: AtsReport }) {
  const tone = scoreTone(report.score);
  return (
    <div className="flex items-center gap-5 rounded-xl border bg-white p-4">
      <div className="shrink-0 text-center">
        <p className="tabular-nums text-slate-900">
          <span className="text-4xl font-semibold">{report.score}</span>
          <span className="ml-0.5 text-sm text-slate-400">/100</span>
        </p>
        <span
          className={cn(
            'mt-1.5 inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
            tone.badge
          )}
        >
          {tone.label}
        </span>
      </div>
      <div className="flex-1 space-y-2.5">
        <ScoreBar label="Parsing" score={report.scores.parsing} />
        <ScoreBar label="Content" score={report.scores.content} />
        <ScoreBar label="Job match" score={report.scores.jobMatch} />
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  collapsible = false,
  action,
  children,
}: {
  title: string;
  count?: number;
  /** Click the heading to hide the body; open by default. */
  collapsible?: boolean;
  /** Shown at the right of the heading while the section is open. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const heading = (
    <>
      {title}
      {count !== undefined && <span className="ml-1.5 font-normal text-slate-500">{count}</span>}
    </>
  );
  return (
    <section className="space-y-2">
      <div className="flex min-h-6 items-center justify-between gap-2">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex flex-1 items-center gap-1 text-left text-sm font-semibold text-slate-900"
          >
            <ChevronDown className={cn('size-4 shrink-0 text-slate-400 transition-transform', !open && '-rotate-90')} />
            {heading}
          </button>
        ) : (
          <h3 className="text-sm font-semibold text-slate-900">{heading}</h3>
        )}
        {action && (!collapsible || open) && <div className="shrink-0">{action}</div>}
      </div>
      {(!collapsible || open) && children}
    </section>
  );
}

function KeywordChip({ keyword }: { keyword: AtsKeyword }) {
  return (
    <span
      title={keyword.matchedAs ? `Found as "${keyword.matchedAs}"` : undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs',
        keyword.matched
          ? 'border-transparent bg-slate-100 text-slate-600'
          : 'border-slate-300 bg-white text-slate-800'
      )}
    >
      {keyword.matched && <Check className="size-3 text-slate-400" />}
      <span>
        {keyword.keyword}
        {!keyword.matched && keyword.importance === 'required' && (
          <span title="Required" className="ml-0.5 font-semibold text-[hsl(0_55%_45%)]">
            *<span className="sr-only"> (required)</span>
          </span>
        )}
      </span>
    </span>
  );
}

/** Draft for the chat: add the missing keywords the candidate actually has. */
function keywordsPrompt(missing: AtsKeyword[]): string {
  const list = missing.map((k) => (k.importance === 'required' ? `${k.keyword} (required)` : k.keyword)).join(', ');
  return `Help me add these keywords from the job description to my resume: ${list}. Before editing, ask me which ones I actually have experience with and where I used them. Only add those, in the job's wording, and don't invent experience.`;
}

function JobMatchSection({ report, onAskAi }: { report: AtsReport; onAskAi: (prompt: string) => void }) {
  if (!report.jobMatch) return null;
  const missing = report.jobMatch.keywords
    .filter((k) => !k.matched)
    .sort((a, b) => (a.importance === b.importance ? 0 : a.importance === 'required' ? -1 : 1));
  const found = report.jobMatch.keywords.filter((k) => k.matched);
  return (
    <Section title="Job match" collapsible>
      {missing.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-600">
            These keywords from the job aren't on your resume. Add the ones you actually have, using the same words.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((k) => (
              <KeywordChip key={k.keyword} keyword={k} />
            ))}
          </div>
          {missing.some((k) => k.importance === 'required') && (
            <p className="text-[11px] text-slate-500">
              <span className="font-semibold text-[hsl(0_55%_45%)]">*</span> Required by the job
            </p>
          )}
          <Button
            size="xs"
            variant="outline"
            className="mt-2.5 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => onAskAi(keywordsPrompt(missing))}
          >
            <WandSparkles className="size-3" />
            Ask AI to add them
          </Button>
        </div>
      ) : (
        <p className="text-xs text-green-700">Every keyword from the job description is on your resume.</p>
      )}
      {found.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Found</p>
          <div className="flex flex-wrap gap-1.5">
            {found.map((k) => (
              <KeywordChip key={k.keyword} keyword={k} />
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// The category badge is tinted by priority (same soft tones as the verdict badge).
const SEVERITY_BADGE: Record<AtsIssue['severity'], string> = {
  high: 'bg-red-50 text-red-700 ring-red-600/20',
  medium: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  low: 'bg-slate-50 text-slate-600 ring-slate-500/20',
};

export type AtsFix = { find: string; replace: string; title: string };

/** Draft for the chat when the fix needs something only the candidate knows. */
function askAiPrompt(issue: AtsIssue): string {
  return `Help me fix this in my resume: ${issue.title}. ${issue.reason} Ask me for any details you need and don't invent numbers or facts.`;
}

function IssueCard({
  issue,
  tex,
  onApply,
  onAskAi,
}: {
  issue: AtsIssue;
  tex: string;
  onApply: (fixes: AtsFix[]) => void;
  onAskAi: (prompt: string) => void;
}) {
  const state = issue.fix ? fixState(tex, issue.fix) : null;
  return (
    <li className={cn('rounded-lg border bg-white p-3 text-sm', state === 'applied' && 'border-green-200 bg-green-50/40')}>
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="font-medium text-slate-900">{issue.title}</p>
        <span
          title={`${issue.severity} priority`}
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset',
            SEVERITY_BADGE[issue.severity]
          )}
        >
          {issue.category}
          <span className="sr-only">, {issue.severity} priority</span>
        </span>
      </div>
      <p className="text-slate-600">{issue.reason}</p>
      {issue.fix && state !== 'applied' && (
        <div className="mt-2 rounded-md bg-slate-50 px-2.5 py-2 font-mono text-xs leading-relaxed">
          <p className="text-red-700 line-through decoration-red-300">{issue.fix.find}</p>
          <p className="text-green-800">{issue.fix.replace}</p>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        {issue.fix && state === 'ready' && (
          <Button size="xs" onClick={() => onApply([{ ...issue.fix!, title: issue.title }])}>
            <Check className="size-3" />
            Apply
          </Button>
        )}
        {issue.fix && state === 'applied' && (
          <>
            <span className="flex items-center gap-1 text-xs font-medium text-green-700">
              <Check className="size-3.5" />
              Applied
            </span>
            <Button
              size="xs"
              variant="ghost"
              className="text-slate-600"
              onClick={() => onApply([{ ...undoFix(issue.fix!), title: `Undo: ${issue.title}` }])}
            >
              <Undo2 className="size-3" />
              Undo
            </Button>
          </>
        )}
        {issue.fix && state === 'stale' && (
          <span className="text-xs text-slate-500">This line has changed since the analysis.</span>
        )}
        {!issue.fix && (
          <Button size="xs" variant="outline" onClick={() => onAskAi(askAiPrompt(issue))}>
            <MessageSquare className="size-3" />
            Ask AI
          </Button>
        )}
      </div>
    </li>
  );
}

const CHECK_ICON = {
  pass: <CircleCheck className="size-4 shrink-0 text-green-600" />,
  warn: <TriangleAlert className="size-4 shrink-0 text-amber-600" />,
  fail: <CircleX className="size-4 shrink-0 text-red-600" />,
};

function CheckRow({ check }: { check: AtsCheck }) {
  return (
    <li className="flex gap-2.5 py-2 text-sm">
      <span className="mt-0.5">{CHECK_ICON[check.status]}</span>
      <div>
        <p className="font-medium text-slate-900">{check.title}</p>
        <p className="text-slate-600">{check.detail}</p>
      </div>
    </li>
  );
}

function ChecksSection({ checks }: { checks: AtsCheck[] }) {
  const [showPassed, setShowPassed] = useState(false);
  const problems = checks
    .filter((c) => c.status !== 'pass')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1));
  const passed = checks.filter((c) => c.status === 'pass');
  return (
    <Section title="Parsing checks" collapsible>
      {problems.length > 0 && (
        <ul className="divide-y rounded-lg border bg-white px-3">
          {problems.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </ul>
      )}
      {passed.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowPassed((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            <ChevronDown className={cn('size-3.5 transition-transform', showPassed && 'rotate-180')} />
            {passed.length} check{passed.length === 1 ? '' : 's'} passed
          </button>
          {showPassed && (
            <ul className="mt-2 divide-y rounded-lg border bg-white px-3">
              {passed.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

function Upsell() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-slate-50 px-8 text-center">
      <ScanSearch className="mb-3 size-7 text-primary" />
      <h2 className="text-base font-semibold text-slate-900">Get past the ATS</h2>
      <p className="mt-1 max-w-xs text-sm text-slate-600">
        See how hiring software reads your resume and what a job is looking for.
      </p>
      <Button className="mt-4" onClick={() => PaywallActions.open('ats')}>
        Upgrade to Pro
      </Button>
    </div>
  );
}

export function AtsPanel({
  projectId,
  tex,
  pdfData,
  compiling,
  onApplyFixes,
  onAskAi,
}: {
  projectId: string;
  /** The resume's current LaTeX source. */
  tex: string;
  /** Base64 of the last compiled PDF; null before the first compile. */
  pdfData: string | null;
  compiling: boolean;
  /** Applies the fixes to main.tex through the editor's edit flow. */
  onApplyFixes: (fixes: AtsFix[]) => void;
  /** Opens the chat with a draft prompt for an issue without a fix. */
  onAskAi: (prompt: string) => void;
}) {
  const { usage } = useSubscriptionUsage();
  const access = canUseFeature(usage, 'ats');
  const { data: saved, isLoading, mutate } = useSWR(['ats-report', projectId], () => getAtsReport(projectId));

  const [jobDescription, setJobDescription] = useState('');
  const [jobTouched, setJobTouched] = useState(false);
  const [running, setRunning] = useState(false);
  const [currentHash, setCurrentHash] = useState<string | null>(null);

  // Start from the job description the saved report was run against.
  useEffect(() => {
    if (!jobTouched && saved?.jobDescription) setJobDescription(saved.jobDescription);
  }, [saved?.jobDescription, jobTouched]);

  useEffect(() => {
    let cancelled = false;
    hashTex(tex).then((hash) => {
      if (!cancelled) setCurrentHash(hash);
    });
    return () => {
      cancelled = true;
    };
  }, [tex]);

  if (!access.allowed && access.reason === 'paywall') return <Upsell />;

  const job = jobDescription.trim() || null;
  const sourceChanged = !!saved && currentHash !== null && currentHash !== saved.texHash;
  const jobChanged = !!saved && job !== (saved.jobDescription ?? null);
  const canRun = access.allowed && !!pdfData && !compiling && !running && !!tex.trim();

  const run = async () => {
    if (!pdfData) return;
    setRunning(true);
    try {
      const next: AtsSavedReport = await runAtsAnalysis({ projectId, tex, pdf: pdfData, jobDescription: job });
      await mutate(next, { revalidate: false });
    } catch (error) {
      if (error instanceof AtsRequestError && error.upgradeRequired) {
        PaywallActions.open('ats');
      } else {
        toast.error(error instanceof Error ? error.message : 'The analysis failed. Please try again.');
      }
    } finally {
      setRunning(false);
    }
  };

  const runLabel = running ? 'Analyzing…' : saved ? 'Re-run analysis' : 'Analyze resume';
  // Applied fixes sink to the end; the rest keep the review's order (most important first).
  const isApplied = (issue: AtsIssue) => !!issue.fix && fixState(tex, issue.fix) === 'applied';
  const issuesInOrder = [...(saved?.report.issues ?? [])].sort((a, b) => Number(isApplied(a)) - Number(isApplied(b)));
  const readyFixes: AtsFix[] = (saved?.report.issues ?? []).flatMap((issue) =>
    issue.fix && fixState(tex, issue.fix) === 'ready' ? [{ ...issue.fix, title: issue.title }] : []
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-slate-50">
      <div className="space-y-5 p-4">
        <div className="space-y-2">
          <label htmlFor="ats-job-description" className="text-sm font-semibold text-slate-900">
            Job description <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <Textarea
            id="ats-job-description"
            value={jobDescription}
            onChange={(e) => {
              setJobTouched(true);
              setJobDescription(e.target.value.slice(0, MAX_JOB_DESCRIPTION_CHARS));
            }}
            placeholder="Paste the job you're applying for to see which keywords your resume is missing."
            className="min-h-40 resize-y bg-white text-sm"
          />
          <div className="flex items-center gap-3">
            <Button onClick={run} disabled={!canRun} size="sm">
              {running ? <Loader2 className="size-4 animate-spin" /> : saved ? <RefreshCw className="size-4" /> : <ScanSearch className="size-4" />}
              {runLabel}
            </Button>
            <p className="text-xs text-slate-500">
              {running
                ? 'This takes about 10 seconds.'
                : !pdfData
                  ? 'Compile your resume first.'
                  : saved && (sourceChanged || jobChanged)
                    ? jobChanged
                      ? 'Re-run to match the new job description.'
                      : 'Your resume changed since this analysis.'
                    : saved
                      ? `Analyzed ${timeAgo(saved.analyzedAt)}`
                      : null}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-slate-400" />
          </div>
        ) : saved ? (
          <div className={cn('space-y-5', running && 'pointer-events-none opacity-50')}>
            <ScoreCard report={saved.report} />
            <JobMatchSection report={saved.report} onAskAi={onAskAi} />
            {saved.report.issues.length > 0 && (
              <Section
                title="Content"
                count={saved.report.issues.length}
                collapsible
                action={
                  readyFixes.length > 1 && (
                    <Button size="xs" variant="outline" onClick={() => onApplyFixes(readyFixes)}>
                      <Check className="size-3" />
                      Apply all {readyFixes.length} rewrites
                    </Button>
                  )
                }
              >
                <ul className="space-y-2">
                  {issuesInOrder.map((issue) => (
                    <IssueCard key={issue.id} issue={issue} tex={tex} onApply={onApplyFixes} onAskAi={onAskAi} />
                  ))}
                </ul>
              </Section>
            )}
            <ChecksSection checks={saved.report.checks} />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-white px-6 py-10 text-center">
            <ScanSearch className="mx-auto mb-2 size-6 text-slate-400" />
            <p className="text-sm font-medium text-slate-900">No analysis yet</p>
            <p className="mt-1 text-sm text-slate-600">
              Checks how an applicant tracking system reads your compiled PDF, reviews your bullets, and, with a job
              description, scores the keyword match.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
