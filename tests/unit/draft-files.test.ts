import { describe, it, expect } from 'vitest';
import {
  DRAFT_MAX_FILES,
  draftProjectFiles,
  parseDraftFilesField,
  storedDraftFiles,
  validateDraftFiles,
} from '@/lib/import/draft-files';

/**
 * lib/import/draft-files.ts validates the optional multi-file payload of an
 * "Open in Octree" draft: paths like the compile API, caps, main detection.
 */

const DOC = '\\documentclass{article}\n\\begin{document}\\cite{a}\\bibliography{refs}\\end{document}';
const BIB = '@article{a, title={A}}';

describe('validateDraftFiles', () => {
  it('accepts a project and puts the \\documentclass file first', () => {
    const result = validateDraftFiles([
      { path: 'refs.bib', content: BIB },
      { path: 'sections/intro.tex', content: 'Intro' },
      { path: 'paper.tex', content: DOC },
    ]);

    expect(result).toEqual({
      ok: true,
      main: 'paper.tex',
      files: [
        { path: 'paper.tex', content: DOC },
        { path: 'refs.bib', content: BIB },
        { path: 'sections/intro.tex', content: 'Intro' },
      ],
    });
  });

  it('prefers main.tex when it has \\documentclass, and honours an explicit main', () => {
    const files = [
      { path: 'other.tex', content: DOC },
      { path: 'main.tex', content: DOC },
    ];
    expect(validateDraftFiles(files)).toMatchObject({ ok: true, main: 'main.tex' });
    expect(validateDraftFiles(files, 'other.tex')).toMatchObject({ ok: true, main: 'other.tex' });
  });

  it('skips a main.tex without \\documentclass in favour of the file that has one', () => {
    const result = validateDraftFiles([
      { path: 'main.tex', content: '\\section{Body}' },
      { path: 'root.tex', content: DOC },
    ]);
    expect(result).toMatchObject({ ok: true, main: 'root.tex' });
  });

  it('normalises harmless paths', () => {
    const result = validateDraftFiles([
      { path: './main.tex', content: DOC },
      { path: 'a/./b.bib', content: BIB },
    ]);
    expect(result.ok && result.files.map((f) => f.path)).toEqual(['main.tex', 'a/b.bib']);
  });

  it.each([
    ['../escape.tex'],
    ['a/../../escape.tex'],
    ['/etc/passwd'],
    ['C:/x.tex'],
    ['dir\\x.tex'],
    ['a\0b.tex'],
    [''],
    ['dir/'],
    ['x'.repeat(513)],
  ])('rejects the path %j', (path) => {
    const result = validateDraftFiles([
      { path: 'main.tex', content: DOC },
      { path, content: 'x' },
    ]);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects duplicates, non-string content and binary files', () => {
    expect(
      validateDraftFiles([
        { path: 'main.tex', content: DOC },
        { path: './main.tex', content: DOC },
      ])
    ).toMatchObject({ ok: false, status: 400 });
    expect(validateDraftFiles([{ path: 'main.tex', content: 42 }])).toMatchObject({ ok: false, status: 400 });
    expect(
      validateDraftFiles([
        { path: 'main.tex', content: DOC },
        { path: 'fig.png', content: 'iVBOR' },
      ])
    ).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('text files') });
  });

  it('rejects an empty list, a non-array, and more than 50 files', () => {
    expect(validateDraftFiles([])).toMatchObject({ ok: false, status: 400 });
    expect(validateDraftFiles({ path: 'main.tex' })).toMatchObject({ ok: false, status: 400 });

    const many = [{ path: 'main.tex', content: DOC }];
    for (let i = 1; i <= DRAFT_MAX_FILES; i++) many.push({ path: `s${i}.tex`, content: 'x' });
    expect(many).toHaveLength(DRAFT_MAX_FILES + 1);
    expect(validateDraftFiles(many)).toMatchObject({ ok: false, status: 400 });
    expect(validateDraftFiles(many.slice(0, DRAFT_MAX_FILES))).toMatchObject({ ok: true });
  });

  it('rejects more than 2 MB in total with 413', () => {
    const half = 'x'.repeat(1024 * 1024 + 1);
    const result = validateDraftFiles([
      { path: 'main.tex', content: DOC },
      { path: 'a.tex', content: half },
      { path: 'b.tex', content: half },
    ]);
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it('needs a main file with \\documentclass', () => {
    expect(validateDraftFiles([{ path: 'refs.bib', content: BIB }])).toMatchObject({ ok: false, status: 400 });
    expect(
      validateDraftFiles([{ path: 'main.tex', content: DOC }], 'missing.tex')
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      validateDraftFiles(
        [
          { path: 'main.tex', content: DOC },
          { path: 'refs.bib', content: BIB },
        ],
        'refs.bib'
      )
    ).toMatchObject({ ok: false, status: 400 });
  });
});

describe('parseDraftFilesField', () => {
  it('parses the form field and passes JSON-body arrays through', () => {
    expect(parseDraftFilesField('[{"path":"main.tex","content":"x"}]')).toEqual({
      ok: true,
      value: [{ path: 'main.tex', content: 'x' }],
    });
    const arr = [{ path: 'a', content: 'b' }];
    expect(parseDraftFilesField(arr)).toEqual({ ok: true, value: arr });
    expect(parseDraftFilesField('{not json')).toEqual({ ok: false });
  });
});

describe('storedDraftFiles / draftProjectFiles', () => {
  it('returns null for single-file rows (no column, null, empty)', () => {
    expect(storedDraftFiles({})).toBeNull();
    expect(storedDraftFiles({ files: null })).toBeNull();
    expect(storedDraftFiles({ files: [] })).toBeNull();
    expect(draftProjectFiles({ content: DOC, files: null })).toEqual([{ path: 'main.tex', content: DOC }]);
  });

  it('keeps the stored order (main first) even when another file also has \\documentclass', () => {
    const files = [
      { path: 'paper.tex', content: DOC },
      { path: 'main.tex', content: DOC },
    ];
    expect(storedDraftFiles({ files })?.map((f) => f.path)).toEqual(['paper.tex', 'main.tex']);
  });

  it('falls back to content when a row inserted around the API has invalid files', () => {
    expect(
      draftProjectFiles({ content: DOC, files: [{ path: '../x.tex', content: DOC }] })
    ).toEqual([{ path: 'main.tex', content: DOC }]);
  });
});
