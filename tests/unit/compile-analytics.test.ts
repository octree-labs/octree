import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * lib/analytics/compile.ts: the `error_kind` buckets and error summary of a
 * failed `compile_completed`, and the sampling decision that keeps a
 * browser's first successful compiles unsampled.
 */

import {
  COMPILE_SUCCESS_SAMPLE_RATE,
  FIRST_COMPILES_UNSAMPLED,
  SUCCESSFUL_COMPILE_COUNT_KEY,
  classifyCompileError,
  countLatexErrors,
  decideCompileSampling,
  describeCompileFailure,
  firstLatexErrorLine,
  readSuccessfulCompileCount,
  writeSuccessfulCompileCount,
} from '@/lib/analytics/compile';

const LOG = [
  'This is pdfTeX, Version 3.141592653',
  '(./main.tex',
  '! LaTeX Error: File `tikz-cd.sty\' not found.',
  '',
  'l.4 \\usepackage{tikz-cd}',
  '! Undefined control sequence.',
  'l.12 \\foo',
  'No pages of output.',
].join('\n');

describe('classifyCompileError', () => {
  it('buckets by the first TeX error line of the log', () => {
    expect(classifyCompileError({ message: 'LaTeX compilation failed', log: LOG })).toBe(
      'missing_package'
    );
    expect(
      classifyCompileError({ message: 'x', log: '! Undefined control sequence.\nl.3 \\bar' })
    ).toBe('undefined_control_sequence');
    expect(classifyCompileError({ message: 'x', log: '! Missing $ inserted.' })).toBe(
      'missing_dollar'
    );
    expect(classifyCompileError({ message: 'x', log: '! Missing } inserted.' })).toBe(
      'missing_brace'
    );
    expect(classifyCompileError({ message: 'x', log: "! Too many }'s." })).toBe('missing_brace');
    expect(classifyCompileError({ message: 'x', log: '! Emergency stop.' })).toBe('latex_error');
    expect(classifyCompileError({ message: 'x', log: "! LaTeX Error: File `foo.cls' not found." })).toBe(
      'missing_package'
    );
  });

  it('reads stdout when there is no log', () => {
    expect(classifyCompileError({ message: 'x', stdout: 'junk\n! Missing $ inserted.' })).toBe(
      'missing_dollar'
    );
  });

  it('tells transport failures apart by HTTP status before looking at text', () => {
    expect(classifyCompileError({ message: 'LaTeX compilation timed out' }, 408)).toBe('timeout');
    expect(classifyCompileError({ message: 'x', log: '! Missing $ inserted.' }, 504)).toBe('timeout');
    expect(classifyCompileError({ message: 'Invalid or expired token' }, 401)).toBe('unauthorized');
    expect(classifyCompileError({ message: 'x' }, 503)).toBe('service_unavailable');
    expect(classifyCompileError({ message: 'x' }, 502)).toBe('service_unavailable');
    expect(classifyCompileError({ message: 'x' }, 429)).toBe('service_unavailable');
  });

  it('falls back to the message when nothing reached TeX', () => {
    expect(classifyCompileError({ message: 'Failed to fetch' })).toBe('network');
    expect(classifyCompileError({ message: 'NetworkError when attempting to fetch resource.' })).toBe(
      'network'
    );
    expect(classifyCompileError({ message: 'NEXT_PUBLIC_COMPILE_SERVICE_URL is not configured' })).toBe(
      'network'
    );
    expect(classifyCompileError({ message: 'LaTeX compilation timed out' })).toBe('timeout');
    expect(classifyCompileError({ message: 'Compile service unavailable' })).toBe(
      'service_unavailable'
    );
    expect(classifyCompileError({ message: 'Unauthorized' })).toBe('unauthorized');
    expect(classifyCompileError({ message: 'No PDF data received' })).toBe('latex_error');
    expect(classifyCompileError(null)).toBe('latex_error');
  });
});

describe('describeCompileFailure', () => {
  it('summarises the first `! ` line, counts the errors and keeps the status', () => {
    expect(
      describeCompileFailure({ message: 'LaTeX compilation failed', log: LOG }, 500)
    ).toEqual({
      error_kind: 'missing_package',
      error_summary: "! LaTeX Error: File `tikz-cd.sty' not found.",
      error_count: 2,
      http_status: 500,
    });
  });

  it('uses the message when there is no log, and never a status of 0', () => {
    expect(describeCompileFailure({ message: 'Failed to fetch', details: 'TypeError: ...' })).toEqual({
      error_kind: 'network',
      error_summary: 'Failed to fetch',
    });
    expect(describeCompileFailure({ message: 'x' }, 0)).toEqual({
      error_kind: 'latex_error',
      error_summary: 'x',
    });
  });

  it('truncates the summary to 200 characters', () => {
    const long = '! ' + 'a'.repeat(400);
    const props = describeCompileFailure({ message: 'x', log: long });
    expect(props.error_summary).toHaveLength(200);
    expect(props.error_summary?.startsWith('! aaa')).toBe(true);
  });

  it('log helpers', () => {
    expect(firstLatexErrorLine(undefined)).toBeUndefined();
    expect(firstLatexErrorLine('no errors here')).toBeUndefined();
    expect(firstLatexErrorLine(LOG)).toBe("! LaTeX Error: File `tikz-cd.sty' not found.");
    expect(countLatexErrors(undefined)).toBeUndefined();
    expect(countLatexErrors('clean')).toBe(0);
    expect(countLatexErrors(LOG)).toBe(2);
  });
});

describe('decideCompileSampling', () => {
  const never = vi.fn(() => false);
  const always = vi.fn(() => true);

  beforeEach(() => {
    never.mockClear();
    always.mockClear();
  });

  it('always captures a failure, with the successes so far as compile_index', () => {
    expect(decideCompileSampling(false, 0, never)).toEqual({
      capture: true,
      sample_rate: 1,
      compile_index: 0,
    });
    expect(decideCompileSampling(false, 7, never)).toEqual({
      capture: true,
      sample_rate: 1,
      compile_index: 7,
    });
    expect(decideCompileSampling(false, null, never)).toEqual({
      capture: true,
      sample_rate: 1,
      compile_index: null,
    });
    expect(never).not.toHaveBeenCalled();
  });

  it(`captures the first ${FIRST_COMPILES_UNSAMPLED} successes unsampled`, () => {
    for (let before = 0; before < FIRST_COMPILES_UNSAMPLED; before += 1) {
      expect(decideCompileSampling(true, before, never)).toEqual({
        capture: true,
        sample_rate: 1,
        compile_index: before + 1,
      });
    }
    expect(never).not.toHaveBeenCalled();
  });

  it('samples later successes 1 in N but still reports compile_index', () => {
    expect(decideCompileSampling(true, FIRST_COMPILES_UNSAMPLED, never)).toEqual({
      capture: false,
      sample_rate: COMPILE_SUCCESS_SAMPLE_RATE,
      compile_index: FIRST_COMPILES_UNSAMPLED + 1,
    });
    expect(never).toHaveBeenCalledWith(COMPILE_SUCCESS_SAMPLE_RATE);
    expect(decideCompileSampling(true, 42, always)).toEqual({
      capture: true,
      sample_rate: COMPILE_SUCCESS_SAMPLE_RATE,
      compile_index: 43,
    });
  });

  it('falls back to plain sampling when the counter is unavailable', () => {
    expect(decideCompileSampling(true, null, never)).toEqual({
      capture: false,
      sample_rate: COMPILE_SUCCESS_SAMPLE_RATE,
      compile_index: null,
    });
    expect(decideCompileSampling(true, null, always)).toEqual({
      capture: true,
      sample_rate: COMPILE_SUCCESS_SAMPLE_RATE,
      compile_index: null,
    });
  });
});

describe('successful compile counter', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts at 0, round-trips, and ignores garbage', () => {
    expect(readSuccessfulCompileCount()).toBe(0);
    writeSuccessfulCompileCount(3);
    expect(window.localStorage.getItem(SUCCESSFUL_COMPILE_COUNT_KEY)).toBe('3');
    expect(readSuccessfulCompileCount()).toBe(3);
    window.localStorage.setItem(SUCCESSFUL_COMPILE_COUNT_KEY, 'nope');
    expect(readSuccessfulCompileCount()).toBe(0);
  });

  it('reports null (fall back to sampling) when storage throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(readSuccessfulCompileCount()).toBeNull();
    expect(() => writeSuccessfulCompileCount(1)).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
