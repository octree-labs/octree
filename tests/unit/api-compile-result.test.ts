import { describe, it, expect } from 'vitest';
import {
  buildCompileFailure,
  buildCompileSuccess,
  classifyServiceFailure,
  logTail,
  LOG_TAIL_CHARS,
  parseLatexErrors,
  parseLatexWarnings,
} from '@/lib/api/compile-result';

const FILE_LINE_LOG = [
  'This is pdfTeX, Version 3.141592653-2.6-1.40.26',
  '(/tmp/latex-abc123/main.tex',
  'LaTeX2e <2024-11-01>',
  './main.tex:12: Undefined control sequence.',
  'l.12 \\foo',
  '',
  './sections/intro.tex:3: LaTeX Error: File `missingpkg.sty\' not found.',
  './main.tex:12: Undefined control sequence.',
  'LaTeX Warning: Reference `fig:1\' on page 1 undefined on input line 20.',
  'Package hyperref Warning: Token not allowed in a PDF string on input line 4.',
].join('\n');

const BANG_LOG = [
  '! Missing $ inserted.',
  '<inserted text>',
  '                $',
  'l.7 a_',
  '      b',
  '! Too many }\'s.',
  'l.9 }',
].join('\n');

describe('parseLatexErrors', () => {
  it('reads -file-line-error lines with file, line and kind, deduplicated', () => {
    expect(parseLatexErrors(FILE_LINE_LOG)).toEqual([
      { file: 'main.tex', line: 12, message: 'Undefined control sequence.', kind: 'undefined_control_sequence' },
      {
        file: 'sections/intro.tex',
        line: 3,
        message: "LaTeX Error: File `missingpkg.sty' not found.",
        kind: 'missing_package',
      },
    ]);
  });

  it('reads `! ` lines and takes the line number from the l.<n> context', () => {
    expect(parseLatexErrors(BANG_LOG)).toEqual([
      { file: null, line: 7, message: 'Missing $ inserted.', kind: 'missing_dollar' },
      { file: null, line: 9, message: "Too many }'s.", kind: 'missing_brace' },
    ]);
  });

  it('never reports a transport kind for a TeX message', () => {
    const [error] = parseLatexErrors('./main.tex:1: Package foo Error: network timeout while loading.');
    expect(error.kind).toBe('latex_error');
  });

  it('returns nothing for an empty log', () => {
    expect(parseLatexErrors(undefined)).toEqual([]);
    expect(parseLatexErrors('just noise')).toEqual([]);
  });
});

describe('warnings and log tail', () => {
  it('collects warning lines', () => {
    expect(parseLatexWarnings(FILE_LINE_LOG)).toEqual([
      "LaTeX Warning: Reference `fig:1' on page 1 undefined on input line 20.",
      'Package hyperref Warning: Token not allowed in a PDF string on input line 4.',
    ]);
  });

  it('strips compile-host temp paths and keeps the end of long logs', () => {
    expect(logTail('(/tmp/latex-abc123/main.tex')).toBe('(./main.tex');
    const long = 'a'.repeat(LOG_TAIL_CHARS) + 'THE END';
    expect(logTail(long).endsWith('THE END')).toBe(true);
    expect(logTail(long)).toHaveLength(LOG_TAIL_CHARS);
  });
});

describe('classifyServiceFailure', () => {
  it('tells LaTeX failures from service problems', () => {
    expect(classifyServiceFailure({ status: 500, error: 'LaTeX compilation failed', details: '' })).toBe('latex');
    expect(classifyServiceFailure({ status: 400, error: 'Invalid request', details: '' })).toBe('invalid_request');
    expect(classifyServiceFailure({ status: 413, error: 'Request too large', details: '' })).toBe('invalid_request');
    expect(classifyServiceFailure({ timedOut: true, error: 'timed out', details: '' })).toBe('timeout');
    expect(classifyServiceFailure({ status: 503, error: 'Server busy', details: '' })).toBe('unavailable');
    expect(classifyServiceFailure({ status: 401, error: 'Invalid or expired token', details: '' })).toBe('unavailable');
    expect(classifyServiceFailure({ error: 'fetch failed', details: '' })).toBe('unavailable');
    expect(classifyServiceFailure(undefined)).toBe('unavailable');
  });
});

describe('result bodies', () => {
  it('builds the ok:false body with errors, log tail and a suggestion', () => {
    const failure = buildCompileFailure(
      { status: 500, error: 'LaTeX compilation failed', details: 'exit 12', log: FILE_LINE_LOG },
      1234
    );
    expect(failure.ok).toBe(false);
    expect(failure.errors).toHaveLength(2);
    expect(failure.duration_ms).toBe(1234);
    expect(failure.suggestion).toMatch(/not defined/);
    expect(failure.log_tail).toContain('./main.tex:12: Undefined control sequence.');
    expect(failure.log_tail).not.toContain('/tmp/latex-');
  });

  it('falls back to the service message when the log has no TeX error line', () => {
    const failure = buildCompileFailure(
      { status: 500, error: 'LaTeX compilation failed', details: 'Package minted needs shell escape, which is not supported' },
      5
    );
    expect(failure.errors).toEqual([
      {
        file: null,
        line: null,
        message: 'Package minted needs shell escape, which is not supported',
        kind: 'latex_error',
      },
    ]);
  });

  it('builds the ok:true body', () => {
    expect(buildCompileSuccess('JVBERi0=', 800, 3)).toEqual({
      ok: true,
      pdf_base64: 'JVBERi0=',
      pages: 3,
      duration_ms: 800,
      warnings: [],
      log_tail: '',
    });
    expect(buildCompileSuccess('JVBERi0=', 800)).not.toHaveProperty('pages');
  });
});
