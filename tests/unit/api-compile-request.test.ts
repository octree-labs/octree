import { describe, it, expect } from 'vitest';
import {
  API_MAX_FILES,
  API_MAX_SOURCE_BYTES,
  filePathProblem,
  validateApiCompileRequest,
} from '@/lib/api/compile-request';

const DOC = '\\documentclass{article}\\begin{document}Hi\\end{document}';

function expectInvalid(body: unknown, pattern: RegExp, status = 400) {
  const result = validateApiCompileRequest(body);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.status).toBe(status);
  expect(result.error.body.message).toMatch(pattern);
}

describe('validateApiCompileRequest', () => {
  it('turns a single latex source into main.tex', () => {
    const result = validateApiCompileRequest({ latex: DOC });
    expect(result).toEqual({
      ok: true,
      request: { files: [{ path: 'main.tex', content: DOC }], main: 'main.tex', response: 'json', sourceBytes: DOC.length },
    });
  });

  it('puts the main file first (the compile service compiles the first .tex with \\documentclass)', () => {
    const result = validateApiCompileRequest({
      files: [
        { path: 'chapters/one.tex', content: '\\documentclass{book} % a standalone draft' },
        { path: 'refs.bib', content: '@book{x}' },
        { path: 'thesis.tex', content: DOC },
      ],
      main: 'thesis.tex',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.main).toBe('thesis.tex');
    expect(result.request.files.map((f) => f.path)).toEqual(['thesis.tex', 'chapters/one.tex', 'refs.bib']);
  });

  it('defaults main to main.tex, else the first .tex with \\documentclass', () => {
    const a = validateApiCompileRequest({ files: [{ path: 'a.tex', content: 'x' }, { path: 'main.tex', content: DOC }] });
    expect(a.ok && a.request.main).toBe('main.tex');
    const b = validateApiCompileRequest({ files: [{ path: 'a.tex', content: 'x' }, { path: 'paper.tex', content: DOC }] });
    expect(b.ok && b.request.main).toBe('paper.tex');
    expectInvalid({ files: [{ path: 'a.tex', content: 'no class' }] }, /set "main"/);
  });

  it('normalises ./ paths', () => {
    const result = validateApiCompileRequest({ files: [{ path: './main.tex', content: DOC }], main: './main.tex' });
    expect(result.ok && result.request.files[0].path).toBe('main.tex');
  });

  it('picks the response format: field wins over Accept', () => {
    expect(validateApiCompileRequest({ latex: DOC }, true)).toMatchObject({ ok: true, request: { response: 'pdf' } });
    expect(validateApiCompileRequest({ latex: DOC, response: 'json' }, true)).toMatchObject({
      ok: true,
      request: { response: 'json' },
    });
    expect(validateApiCompileRequest({ latex: DOC, response: 'pdf' })).toMatchObject({ ok: true, request: { response: 'pdf' } });
    expectInvalid({ latex: DOC, response: 'html' }, /"response"/);
  });

  it('rejects malformed requests', () => {
    expectInvalid(null, /JSON object/);
    expectInvalid([], /JSON object/);
    expectInvalid({}, /Missing "latex"/);
    expectInvalid({ latex: DOC, files: [] }, /not both/);
    expectInvalid({ latex: '   ' }, /non-empty/);
    expectInvalid({ latex: DOC, main: 'other.tex' }, /only with "files"/);
    expectInvalid({ files: [] }, /non-empty array/);
    expectInvalid({ files: [{ path: 'main.tex' }] }, /content must be a string/);
    expectInvalid({ files: [{ path: 'main.tex', content: DOC }, { path: './main.tex', content: DOC }] }, /duplicate/);
    expectInvalid({ files: [{ path: 'main.tex', content: DOC }], main: 'nope.tex' }, /not one of the files/);
    expectInvalid({ files: [{ path: 'main.tex', content: DOC }, { path: 'b.bib', content: DOC }], main: 'b.bib' }, /\.tex file/);
    expectInvalid({ files: [{ path: 'main.tex', content: DOC }, { path: 'x.tex', content: 'no class' }], main: 'x.tex' }, /no \\documentclass/);
  });

  it('accepts text files only', () => {
    expectInvalid({ files: [{ path: 'main.tex', content: DOC }, { path: 'a.png', content: 'iVBOR', encoding: 'base64' }] }, /only text files/);
  });

  it('enforces the file count and the 2 MB source limit', () => {
    const many = Array.from({ length: API_MAX_FILES + 1 }, (_, i) => ({ path: `f${i}.tex`, content: DOC }));
    expectInvalid({ files: many }, /Too many files/);
    expectInvalid({ latex: DOC + 'x'.repeat(API_MAX_SOURCE_BYTES) }, /2 MB/, 413);
  });
});

describe('filePathProblem', () => {
  it('mirrors the compile service path rules', () => {
    expect(filePathProblem('main.tex')).toBeNull();
    expect(filePathProblem('sections/intro.tex')).toBeNull();
    expect(filePathProblem('a/../b.tex')).toBeNull();
    expect(filePathProblem('')).toMatch(/non-empty/);
    expect(filePathProblem('/etc/passwd')).toMatch(/relative/);
    expect(filePathProblem('C:/x.tex')).toMatch(/relative/);
    expect(filePathProblem('..')).toMatch(/escapes/);
    expect(filePathProblem('../x.tex')).toMatch(/escapes/);
    expect(filePathProblem('a/../../x.tex')).toMatch(/escapes/);
    expect(filePathProblem('a\\b.tex')).toMatch(/forward slashes/);
    expect(filePathProblem('a\0.tex')).toMatch(/NUL/);
    expect(filePathProblem('x'.repeat(513))).toMatch(/longer/);
    expect(filePathProblem(42)).toMatch(/non-empty string/);
  });
});
