import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';

/**
 * "Fix with AI" on a failed compile: the prompt builder
 * (lib/compile-error-fix.ts), the once-per-compile hook
 * (hooks/use-compile-error-fix.ts) and the button in the error UI.
 */

import {
  ERROR_EXCERPT_MAX,
  buildCompileErrorFixPrompt,
  compileErrorFixButtonLabel,
  compileErrorKindLabel,
  extractLatexErrorExcerpt,
  getCompileErrorFixOffer,
} from '@/lib/compile-error-fix';
import { classifyCompileError, countLatexErrors, firstLatexErrorLine } from '@/lib/analytics/compile';
import { useCompileErrorFix } from '@/hooks/use-compile-error-fix';
import { CompilationError } from '@/components/latex/compilation-error';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { track } from '@/lib/analytics/track';
import type { CompilationError as CompilationErrorType } from '@/types/compilation';

vi.mock('@/lib/analytics/track', () => ({
  track: vi.fn(),
}));
const mockedTrack = vi.mocked(track);

// What the compile service sends back (-file-line-error, tail of main.log).
const FILE_LINE_LOG = [
  'This is pdfTeX, Version 3.141592653',
  '(./main.tex',
  "./main.tex:4: LaTeX Error: File `tikz-cd.sty' not found.",
  '',
  'Type X to quit or <RETURN> to proceed,',
  'or enter new name. (Default extension: sty)',
  '',
  'l.4 \\usepackage',
  '               {amsmath}^^M',
  './main.tex:12: Undefined control sequence.',
  'l.12 \\foo',
  '          ',
  './main.tex:12: Undefined control sequence.',
  'l.12 \\foo',
  'No pages of output.',
].join('\n');

const CLASSIC_LOG = ['! Missing $ inserted.', '<inserted text>', '                $', 'l.7 x^2', ''].join(
  '\n'
);

describe('file-line-error logs', () => {
  it('are read as TeX errors by the compile analytics too', () => {
    expect(firstLatexErrorLine(FILE_LINE_LOG)).toBe(
      "./main.tex:4: LaTeX Error: File `tikz-cd.sty' not found."
    );
    expect(countLatexErrors(FILE_LINE_LOG)).toBe(3);
    expect(classifyCompileError({ message: 'LaTeX compilation failed', log: FILE_LINE_LOG })).toBe(
      'missing_package'
    );
    expect(
      classifyCompileError({ message: 'x', log: 'chapters/intro.tex:3: Undefined control sequence.' })
    ).toBe('undefined_control_sequence');
  });

  it('do not mistake file lists or warnings for errors', () => {
    expect(firstLatexErrorLine('(./main.tex (./sections/a.tex)\nLaTeX Warning: x on input line 4.')).toBe(
      undefined
    );
  });
});

describe('error kind classification across log forms', () => {
  const kind = (log: string) => classifyCompileError({ message: 'LaTeX compilation failed', log });

  it('buckets the file-line and the classic form the same way', () => {
    expect(kind('./main.tex:12: Undefined control sequence.')).toBe('undefined_control_sequence');
    expect(kind('! Undefined control sequence.')).toBe('undefined_control_sequence');
    expect(kind('./main.tex:7: Missing $ inserted.')).toBe('missing_dollar');
    expect(kind('! Missing $ inserted.')).toBe('missing_dollar');
    expect(kind("./main.tex:3: LaTeX Error: File `foo.sty' not found.")).toBe('missing_package');
    expect(kind("! LaTeX Error: File 'foo.sty' not found.")).toBe('missing_package');
    expect(kind('/tmp/job/sections/a.tex:9: Too many }\'s.')).toBe('missing_brace');
    expect(kind('./main.tex:5: Something else.')).toBe('latex_error');
  });

  it('does not count non-error lines that contain a colon and a number', () => {
    const log = [
      'Package: hyperref 2023-02-07 v7.00v Hypertext links for LaTeX',
      '(/usr/local/texlive/2023/texmf-dist/tex/latex/base/size10.clo',
      'Output written on main.pdf (3 pages, 1234 bytes).',
      'LaTeX Warning: Reference `x\' on page 1 undefined on input line 4.',
      'http://example.com:80: not an error',
      'l.12 \\foo',
    ].join('\n');
    expect(countLatexErrors(log)).toBe(0);
    expect(firstLatexErrorLine(log)).toBeUndefined();
  });

  it('reads Windows line endings', () => {
    const log = './main.tex:12: Undefined control sequence.\r\nl.12 \\foo\r\n';
    expect(firstLatexErrorLine(log)).toBe('./main.tex:12: Undefined control sequence.');
    expect(countLatexErrors(log)).toBe(1);
    expect(extractLatexErrorExcerpt(log)).toBe('./main.tex:12: Undefined control sequence.\nl.12 \\foo');
  });
});

describe('extractLatexErrorExcerpt', () => {
  it('pairs each error with its l.<n> line and drops repeats', () => {
    expect(extractLatexErrorExcerpt(FILE_LINE_LOG)).toBe(
      [
        "./main.tex:4: LaTeX Error: File `tikz-cd.sty' not found.",
        'l.4 \\usepackage',
        '',
        './main.tex:12: Undefined control sequence.',
        'l.12 \\foo',
      ].join('\n')
    );
  });

  it('reads the classic `! ` form', () => {
    expect(extractLatexErrorExcerpt(CLASSIC_LOG)).toBe('! Missing $ inserted.\nl.7 x^2');
  });

  it('does not take the next error line as a line reference', () => {
    expect(extractLatexErrorExcerpt('! Emergency stop.\n! ==> Fatal error occurred\nl.9 x')).toBe(
      '! Emergency stop.\n\n! ==> Fatal error occurred\nl.9 x'
    );
  });

  it('keeps at most three errors', () => {
    const log = Array.from({ length: 6 }, (_, i) => `! Error ${i}.\nl.${i} x`).join('\n');
    expect(extractLatexErrorExcerpt(log).split('\n\n')).toHaveLength(3);
  });

  it('caps the excerpt at whole errors, cutting only a single oversized one', () => {
    const big = `! ${'a'.repeat(500)}\nl.1 x`;
    const log = `${big}\n! ${'b'.repeat(500)}\nl.2 y`;
    expect(extractLatexErrorExcerpt(log)).toBe(big);
    const huge = extractLatexErrorExcerpt(`! ${'c'.repeat(2000)}`);
    expect(huge.length).toBe(ERROR_EXCERPT_MAX + 1); // plus the ellipsis
    expect(huge.endsWith('…')).toBe(true);
  });

  it('never ends on half a surrogate pair', () => {
    const excerpt = extractLatexErrorExcerpt(`! ${'a'.repeat(9)}\u{1F600}tail`, 12);
    expect(excerpt).toBe(`! ${'a'.repeat(9)}…`);
  });

  it('keeps an error without an l.<n> line on its own', () => {
    expect(extractLatexErrorExcerpt('! LaTeX Error: Something wrong.\nSee the LaTeX manual.\n')).toBe(
      '! LaTeX Error: Something wrong.'
    );
  });

  it('handles a huge log and replacement characters from non-UTF-8 input', () => {
    const noise = Array.from({ length: 50_000 }, (_, i) => `line ${i} \uFFFD`).join('\n');
    const excerpt = extractLatexErrorExcerpt(`${noise}\n./main.tex:3: Undefined control sequence \uFFFD.\nl.3 x`);
    expect(excerpt).toBe('./main.tex:3: Undefined control sequence \uFFFD.\nl.3 x');
  });

  it('is empty without a TeX error line', () => {
    expect(extractLatexErrorExcerpt(undefined)).toBe('');
    expect(extractLatexErrorExcerpt('Latexmk: all targets up-to-date')).toBe('');
  });
});

describe('buildCompileErrorFixPrompt', () => {
  it('quotes the errors, names the file and asks for a fix and an explanation', () => {
    const prompt = buildCompileErrorFixPrompt({ message: 'failed', log: CLASSIC_LOG }, 'main.tex');
    expect(prompt).toContain('(open file: main.tex)');
    expect(prompt).toContain('! Missing $ inserted.\nl.7 x^2');
    expect(prompt).toMatch(/Fix this error.*explain the change/);
  });

  it('falls back to the error message (capped) when the log has no TeX error', () => {
    const prompt = buildCompileErrorFixPrompt({ message: 'Compilation timed out' }, null);
    expect(prompt).toContain('Compilation timed out');
    expect(prompt).not.toContain('open file');
    const long = buildCompileErrorFixPrompt({ message: 'x'.repeat(5000) }, 'a.tex');
    expect(long.length).toBeLessThan(ERROR_EXCERPT_MAX + 200);
  });

  it('reads stdout when there is no log', () => {
    expect(buildCompileErrorFixPrompt({ message: 'x', stdout: CLASSIC_LOG }, 'a.tex')).toContain(
      '! Missing $ inserted.'
    );
  });
});

describe('labels', () => {
  it('names the common error kinds and stays generic otherwise', () => {
    expect(compileErrorKindLabel('missing_package')).toBe('Missing package');
    expect(compileErrorFixButtonLabel('missing_package')).toBe('Missing package — Fix with AI');
    expect(compileErrorFixButtonLabel('undefined_control_sequence')).toBe(
      'Undefined command — Fix with AI'
    );
    expect(compileErrorKindLabel('latex_error')).toBeNull();
    expect(compileErrorFixButtonLabel('latex_error')).toBe('Fix with AI');
  });
});

describe('getCompileErrorFixOffer', () => {
  it('offers a fix for TeX errors', () => {
    const offer = getCompileErrorFixOffer({ message: 'failed', log: FILE_LINE_LOG }, 'main.tex');
    expect(offer).toMatchObject({
      kind: 'missing_package',
      buttonLabel: 'Missing package — Fix with AI',
      errorCount: 3,
    });
  });

  it('offers nothing when the service, not the document, failed', () => {
    expect(getCompileErrorFixOffer(null, 'main.tex')).toBeNull();
    expect(getCompileErrorFixOffer({ message: 'Failed to fetch' }, 'main.tex')).toBeNull();
    expect(getCompileErrorFixOffer({ message: 'Server busy', httpStatus: 503 }, 'main.tex')).toBeNull();
    expect(getCompileErrorFixOffer({ message: 'x', httpStatus: 401 }, 'main.tex')).toBeNull();
  });
});

describe('useCompileErrorFix', () => {
  beforeEach(() => {
    mockedTrack.mockClear();
    localStorage.clear();
  });

  const error = (): CompilationErrorType => ({ message: 'failed', log: CLASSIC_LOG });

  it('captures `shown` once per failed compile and sends once per click target', () => {
    const onSend = vi.fn();
    const first = error();
    const { result, rerender } = renderHook(
      (props: { compilationError: CompilationErrorType | null }) =>
        useCompileErrorFix({ ...props, fileName: 'main.tex', onSend, enabled: true }),
      { initialProps: { compilationError: first } }
    );
    rerender({ compilationError: first });
    expect(mockedTrack).toHaveBeenCalledTimes(1);
    expect(mockedTrack).toHaveBeenCalledWith(AnalyticsEvents.COMPILE_ERROR_FIX_SHOWN, {
      error_kind: 'missing_dollar',
      error_count: 1,
      compile_index: 0,
    });

    act(() => result.current.fix());
    act(() => result.current.fix());
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toContain('! Missing $ inserted.');
    expect(mockedTrack).toHaveBeenLastCalledWith(AnalyticsEvents.COMPILE_ERROR_FIX_CLICKED, {
      error_kind: 'missing_dollar',
      error_count: 1,
      compile_index: 0,
    });

    // The next failed compile is a new error object: a new offer.
    rerender({ compilationError: error() });
    expect(mockedTrack).toHaveBeenCalledTimes(3);
    act(() => result.current.fix());
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it('offers nothing when switched off or without an error', () => {
    const onSend = vi.fn();
    const off = renderHook(() =>
      useCompileErrorFix({ compilationError: error(), fileName: 'a.tex', onSend, enabled: false })
    );
    expect(off.result.current.offer).toBeNull();
    act(() => off.result.current.fix());
    const none = renderHook(() =>
      useCompileErrorFix({ compilationError: null, fileName: 'a.tex', onSend, enabled: true })
    );
    expect(none.result.current.offer).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
    expect(mockedTrack).not.toHaveBeenCalled();
  });
});

describe('CompilationError fix button', () => {
  it('shows the labelled button on the collapsed error bar', () => {
    const onFix = vi.fn();
    render(
      <CompilationError
        error={{ message: 'failed', log: CLASSIC_LOG }}
        variant="bottom-bar"
        onFixWithAI={onFix}
        fixLabel="Math mode error — Fix with AI"
      />
    );
    const button = screen.getByRole('button', { name: 'Math mode error — Fix with AI' });
    fireEvent.click(button);
    expect(onFix).toHaveBeenCalledTimes(1);
    // Expanding keeps a single fix button.
    fireEvent.click(screen.getByRole('button', { name: /show details/i }));
    expect(screen.getAllByTestId('compile-error-fix')).toHaveLength(1);
  });

  it('keeps the old collapsed bar without a label', () => {
    render(
      <CompilationError error={{ message: 'failed' }} variant="bottom-bar" onFixWithAI={vi.fn()} />
    );
    expect(screen.queryByRole('button', { name: /fix with ai/i })).toBeNull();
  });

  it('labels the overlay button', () => {
    render(
      <CompilationError
        error={{ message: 'failed' }}
        onFixWithAI={vi.fn()}
        fixLabel="Missing package — Fix with AI"
      />
    );
    expect(screen.getByRole('button', { name: 'Missing package — Fix with AI' })).toBeInTheDocument();
  });
});
