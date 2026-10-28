import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * lib/resume/ats: the deterministic parse checks and keyword matching, the
 * fix filter on the AI review, and the score math. The model calls
 * (generateObject) and PDF text extraction are mocked.
 */

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  extractPdfText: vi.fn(),
}));

vi.mock('ai', () => ({ generateObject: mocks.generateObject }));
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (model: string) => model }));
vi.mock('@/lib/resume/extract-text', () => ({ extractPdfText: mocks.extractPdfText }));

import { runParseChecks, scoreChecks } from '@/lib/resume/ats/parse-checks';
import { matchKeywords, scoreJobMatch } from '@/lib/resume/ats/job-match';
import { scoreIssues, toAtsIssues } from '@/lib/resume/ats/content-review';
import { analyzeResume, AtsInputError, overallScore } from '@/lib/resume/ats/analyze';
import { fixState, undoFix } from '@/lib/resume/ats/fix-state';
import type { AtsCheck } from '@/types/resume';

const filler = Array.from({ length: 60 }, (_, i) => `Shipped feature number ${i} for customers`).join('\n');

const RESUME = `Jane Doe
jane.doe@example.com | +1 (555) 123-4567 | linkedin.com/in/janedoe
Experience
Senior Engineer, Acme Corp  Jan 2021 -- Present
Built Kubernetes deployment tooling in Go and TypeScript
Cut CI/CD pipeline time by 40%
${filler}
Education
B.S. Computer Science, State University  Aug 2014 -- May 2018
Technical Skills
Go, TypeScript, PostgreSQL, Docker`;

const byId = (checks: AtsCheck[]) => Object.fromEntries(checks.map((c) => [c.id, c]));

describe('runParseChecks', () => {
  it('passes a clean, standard resume', () => {
    const checks = runParseChecks(RESUME, 1);
    expect(checks.filter((c) => c.status !== 'pass')).toEqual([]);
    expect(scoreChecks(checks)).toBe(100);
  });

  it('fails a missing email and warns about a missing phone', () => {
    const checks = byId(runParseChecks(RESUME.replace(/^jane.*$/m, 'Lahore, Pakistan'), 1));
    expect(checks['contact-email'].status).toBe('fail');
    expect(checks['contact-phone'].status).toBe('warn');
  });

  it('warns when the email is below the header', () => {
    const text = RESUME.replace(/^jane\.doe@example\.com \| /m, '') + '\njane.doe@example.com';
    expect(byId(runParseChecks(text, 1))['contact-email'].status).toBe('warn');
  });

  it('warns when a profile link shows as a label instead of a URL', () => {
    const check = byId(runParseChecks(RESUME.replace('linkedin.com/in/janedoe', 'LinkedIn'), 1))['contact-profile'];
    expect(check.status).toBe('warn');
    expect(check.detail).toContain('Write the address out');
  });

  it('does not take a long line mentioning experience for a heading', () => {
    const text = RESUME.replace(/^Experience$/m, 'Work').replace(
      'Built Kubernetes',
      'Five years of experience building Kubernetes'
    );
    expect(byId(runParseChecks(text, 1))['section-experience'].status).toBe('fail');
  });

  it('softens a missing experience section to a warning when there are projects', () => {
    const text = RESUME.replace(/^Experience$/m, 'Projects');
    expect(byId(runParseChecks(text, 1))['section-experience'].status).toBe('warn');
  });

  it('flags icon-font glyphs as unreadable and ligatures as a warning', () => {
    expect(byId(runParseChecks(` ${RESUME}`, 1))['parsing-characters'].status).toBe('fail');
    expect(byId(runParseChecks(`${RESUME}\nﬁnance`, 1))['parsing-characters'].status).toBe('warn');
  });

  it('warns about mixed date formats', () => {
    const text = RESUME.replace('Aug 2014 -- May 2018', '08/2014 -- 05/2018').replace('Jan 2021', 'Jan 2021');
    expect(byId(runParseChecks(text, 1))['parsing-dates'].status).toBe('warn');
  });

  it('fails a PDF with almost no text and warns past two pages', () => {
    const checks = byId(runParseChecks('Jane Doe\njane@example.com', 3));
    expect(checks['parsing-text'].status).toBe('fail');
    expect(checks['length-pages'].status).toBe('warn');
  });

  it('scores a pass as 1, a warning as half and a failure as 0', () => {
    const c = (status: AtsCheck['status']): AtsCheck => ({ id: status, category: 'parsing', status, title: '', detail: '' });
    expect(scoreChecks([c('pass'), c('warn'), c('fail'), c('pass')])).toBe(63);
  });
});

describe('matchKeywords', () => {
  const kw = (keyword: string, importance: 'required' | 'preferred' = 'required', aliases: string[] = []) => ({
    keyword,
    importance,
    aliases,
  });

  it('matches whole terms only, ignoring case and separators', () => {
    const result = matchKeywords('Java, CSS and ci-cd pipelines', [kw('JavaScript'), kw('C'), kw('CI/CD'), kw('java')]);
    expect(result.map((k) => [k.keyword, k.matched])).toEqual([
      ['JavaScript', false],
      ['C', false],
      ['CI/CD', true],
      ['java', true],
    ]);
  });

  it('matches symbols in names like C++ and C#', () => {
    const result = matchKeywords('Wrote C++ and C# services', [kw('C++'), kw('C#'), kw('C')]);
    expect(result.map((k) => k.matched)).toEqual([true, true, false]);
  });

  it('matches through an alias and records the spelling found', () => {
    const [k8s] = matchKeywords('Ran K8s clusters', [kw('Kubernetes', 'required', ['K8s'])]);
    expect(k8s).toEqual({ keyword: 'Kubernetes', importance: 'required', matched: true, matchedAs: 'K8s' });
  });

  it('folds ligatures extracted from the PDF', () => {
    expect(matchKeywords('ﬁnancial modelling', [kw('financial modelling')])[0].matched).toBe(true);
  });

  it('drops duplicate keywords', () => {
    expect(matchKeywords('Go', [kw('Go'), kw('go')])).toHaveLength(1);
  });

  it('weighs required keywords twice as much as preferred ones', () => {
    expect(
      scoreJobMatch([
        { keyword: 'a', importance: 'required', matched: true },
        { keyword: 'b', importance: 'preferred', matched: false },
      ])
    ).toBe(67);
    expect(scoreJobMatch([])).toBeNull();
  });
});

describe('toAtsIssues', () => {
  const raw = (find: string, replace: string) => ({
    category: 'impact' as const,
    severity: 'high' as const,
    title: 't',
    reason: 'r',
    find,
    replace,
  });
  const tex = '\\item Responsible for managing a team of 5\n\\item Responsible for hiring';

  it('keeps a fix whose text occurs exactly once', () => {
    const [issue] = toAtsIssues(tex, [raw('Responsible for managing', 'Managed')]);
    expect(issue.fix).toEqual({ find: 'Responsible for managing', replace: 'Managed' });
    expect(issue.id).toBe('i0');
  });

  it('keeps the issue but drops an ambiguous, missing, empty or no-op fix', () => {
    const issues = toAtsIssues(tex, [
      raw('Responsible for', 'Led'),
      raw('not in the source', 'x'),
      raw('', ''),
      raw('hiring', 'hiring'),
    ]);
    expect(issues).toHaveLength(4);
    expect(issues.every((i) => i.fix === undefined)).toBe(true);
  });

  it('scores 100 minus 12 / 6 / 2 per high / medium / low issue, floored at 0', () => {
    const issue = (severity: 'high' | 'medium' | 'low') => ({ id: '', category: 'impact' as const, severity, title: '', reason: '' });
    expect(scoreIssues([issue('high'), issue('medium'), issue('low')])).toBe(80);
    expect(scoreIssues(Array.from({ length: 10 }, () => issue('high')))).toBe(0);
  });
});

describe('analyzeResume', () => {
  const pdf = new Uint8Array([1]);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractPdfText.mockResolvedValue({ text: RESUME, totalPages: 1 });
    mocks.generateObject.mockImplementation(async ({ schema }: { schema: { shape: Record<string, unknown> } }) =>
      'keywords' in schema.shape
        ? {
            object: {
              keywords: [
                { keyword: 'Kubernetes', importance: 'required', aliases: [] },
                { keyword: 'Rust', importance: 'required', aliases: [] },
                { keyword: 'Postgres', importance: 'preferred', aliases: ['PostgreSQL'] },
              ],
            },
          }
        : {
            object: {
              issues: [{ category: 'impact', severity: 'medium', title: 't', reason: 'r', find: '', replace: '' }],
            },
          }
    );
  });

  it('combines the parse checks, the review and the job match', async () => {
    const report = await analyzeResume({ tex: '\\documentclass{article}', pdf, jobDescription: 'We need Kubernetes and Rust' });
    expect(report.scores).toEqual({ parsing: 100, content: 94, jobMatch: 60 });
    expect(report.score).toBe(Math.round(100 * 0.35 + 94 * 0.25 + 60 * 0.4));
    expect(report.jobMatch?.keywords.find((k) => k.keyword === 'Postgres')?.matchedAs).toBe('PostgreSQL');
    expect(mocks.generateObject).toHaveBeenCalledTimes(2);
  });

  it('skips job matching without a job description', async () => {
    const report = await analyzeResume({ tex: 'x', pdf, jobDescription: '   ' });
    expect(report.jobMatch).toBeNull();
    expect(report.score).toBe(overallScore({ parsing: 100, content: 94, jobMatch: null }));
    expect(mocks.generateObject).toHaveBeenCalledTimes(1);
  });

  it('rejects long PDFs and PDFs without text before calling the model', async () => {
    mocks.extractPdfText.mockResolvedValueOnce({ text: RESUME, totalPages: 6 });
    await expect(analyzeResume({ tex: 'x', pdf })).rejects.toBeInstanceOf(AtsInputError);
    mocks.extractPdfText.mockResolvedValueOnce({ text: '  ', totalPages: 1 });
    await expect(analyzeResume({ tex: 'x', pdf })).rejects.toBeInstanceOf(AtsInputError);
    expect(mocks.generateObject).not.toHaveBeenCalled();
  });
});

describe('fixState', () => {
  const fix = { find: 'Responsible for managing the API', replace: 'Managed the API' };

  it('is ready while the original occurs exactly once', () => {
    expect(fixState('\\item Responsible for managing the API used by 2M', fix)).toBe('ready');
  });

  it('is applied once the original is gone and the rewrite is there', () => {
    expect(fixState('\\item Managed the API used by 2M', fix)).toBe('applied');
  });

  it('is stale when the line was edited by hand, or is ambiguous', () => {
    expect(fixState('\\item Owned the API', fix)).toBe('stale');
    expect(fixState('Responsible for managing the API\nResponsible for managing the API', fix)).toBe('stale');
  });

  it('undoes by the reverse replacement', () => {
    expect(undoFix(fix)).toEqual({ find: 'Managed the API', replace: 'Responsible for managing the API' });
  });
});
