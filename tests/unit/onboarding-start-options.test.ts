import { describe, it, expect } from 'vitest';

import {
  START_OPTIONS,
  ensureDocument,
  isStartOption,
  latexTitle,
  projectPayloadFromPaste,
  projectPayloadFromTexUpload,
  projectSourceForOption,
  titleFromFileName,
  uploadKind,
} from '@/lib/onboarding/start-options';
import { SAMPLE_ARTICLE_TEX } from '@/lib/onboarding/sample-article';

describe('start options', () => {
  it('lists the four cards in display order, upload first', () => {
    expect(START_OPTIONS).toEqual(['upload', 'paste', 'sample', 'blank']);
  });

  it('maps every option onto a project_created source of the same name', () => {
    for (const option of START_OPTIONS) {
      expect(projectSourceForOption(option)).toBe(option);
    }
  });

  it('recognises options and rejects the text links', () => {
    expect(isStartOption('sample')).toBe(true);
    expect(isStartOption('generate')).toBe(false);
    expect(isStartOption('later')).toBe(false);
  });
});

describe('uploadKind', () => {
  it('accepts .tex and .zip regardless of case and rejects the rest', () => {
    expect(uploadKind('main.tex')).toBe('tex');
    expect(uploadKind('Thesis.TEX')).toBe('tex');
    expect(uploadKind('overleaf-export.zip')).toBe('zip');
    expect(uploadKind('notes.pdf')).toBeNull();
    expect(uploadKind('tex')).toBeNull();
  });
});

describe('latexTitle', () => {
  it('reads a plain title', () => {
    expect(latexTitle('\\title{A Study of Things}\\author{Me}')).toBe('A Study of Things');
  });

  it('keeps nested braces balanced and strips formatting commands', () => {
    expect(latexTitle('\\title{\\textbf{Bold} and {grouped} text\\\\second line}')).toBe(
      'Bold and grouped text second line'
    );
  });

  it('ignores the optional short-title argument style and unknown commands', () => {
    expect(latexTitle('\\title{Rates of \\emph{convergence}\\thanks{Funded by X}}')).toBe(
      'Rates of convergence'
    );
  });

  it('returns null without a title, with an empty title or with unbalanced braces', () => {
    expect(latexTitle('\\section{Intro}')).toBeNull();
    expect(latexTitle('\\title{}')).toBeNull();
    expect(latexTitle('\\title{never closed')).toBeNull();
  });

  it('caps very long titles at the project title limit', () => {
    expect(latexTitle(`\\title{${'x'.repeat(500)}}`)).toHaveLength(120);
  });
});

describe('titleFromFileName', () => {
  it('drops the extension and any folder', () => {
    expect(titleFromFileName('paper.tex')).toBe('paper');
    expect(titleFromFileName('exports/My Thesis.ZIP')).toBe('My Thesis');
  });

  it('falls back when nothing is left', () => {
    expect(titleFromFileName('.tex')).toBe('Pasted document');
  });
});

describe('ensureDocument', () => {
  it('leaves a full document untouched', () => {
    const doc = '\\documentclass{article}\n\\begin{document}hi\\end{document}';
    expect(ensureDocument(doc)).toBe(doc);
  });

  it('wraps a fragment in an article preamble with amsmath', () => {
    const wrapped = ensureDocument('  \\section{Intro}\nSome $x^2$ text.\n');
    expect(wrapped.startsWith('\\documentclass{article}')).toBe(true);
    expect(wrapped).toContain('\\usepackage{amsmath,amssymb}');
    expect(wrapped).toContain('\\begin{document}\n\n\\section{Intro}\nSome $x^2$ text.\n\n\\end{document}');
  });
});

describe('projectPayloadFromPaste', () => {
  it('is null for blank input', () => {
    expect(projectPayloadFromPaste('')).toBeNull();
    expect(projectPayloadFromPaste('   \n\t ')).toBeNull();
  });

  it('names the project after \\title{} and keeps the document', () => {
    const payload = projectPayloadFromPaste(
      '\\documentclass{article}\n\\title{Quantum Widgets}\n\\begin{document}\\maketitle\\end{document}'
    );
    expect(payload).toEqual({
      title: 'Quantum Widgets',
      content:
        '\\documentclass{article}\n\\title{Quantum Widgets}\n\\begin{document}\\maketitle\\end{document}',
    });
  });

  it('uses the fallback title and wraps fragments, normalising CRLF', () => {
    const payload = projectPayloadFromPaste('Hello\r\nworld');
    expect(payload?.title).toBe('Pasted document');
    expect(payload?.content).toContain('\\begin{document}\n\nHello\nworld\n\n\\end{document}');
    expect(payload?.content).not.toContain('\r');
  });
});

describe('projectPayloadFromTexUpload', () => {
  it('prefers \\title{} and otherwise the file name', () => {
    expect(projectPayloadFromTexUpload('draft.tex', '\\title{Real Title}')?.title).toBe('Real Title');
    expect(projectPayloadFromTexUpload('draft.tex', '\\section{A}')?.title).toBe('draft');
  });

  it('is null for an empty file', () => {
    expect(projectPayloadFromTexUpload('empty.tex', '')).toBeNull();
  });
});

describe('sample article', () => {
  it('is a short self-contained article the first AI edit can act on', () => {
    const lines = SAMPLE_ARTICLE_TEX.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(50);
    expect(lines.length).toBeLessThanOrEqual(80);
    expect(SAMPLE_ARTICLE_TEX).toContain('\\documentclass');
    expect(SAMPLE_ARTICLE_TEX).toContain('\\usepackage{amsmath');
    expect(SAMPLE_ARTICLE_TEX).toContain('\\begin{abstract}');
    expect(SAMPLE_ARTICLE_TEX).toContain('\\begin{equation}');
    expect(SAMPLE_ARTICLE_TEX).toContain('\\begin{table}');
    expect(SAMPLE_ARTICLE_TEX).toContain('\\end{document}');
    // Nothing to fill in and no assets to upload before the first compile.
    expect(SAMPLE_ARTICLE_TEX).not.toContain('\\includegraphics');
    expect(SAMPLE_ARTICLE_TEX).not.toMatch(/TODO|lorem ipsum|\[Your/i);
  });

  it('has balanced environments', () => {
    const begins = SAMPLE_ARTICLE_TEX.match(/\\begin\{(\w+)\}/g) ?? [];
    const ends = SAMPLE_ARTICLE_TEX.match(/\\end\{(\w+)\}/g) ?? [];
    expect(begins.map((b) => b.slice(7, -1)).sort()).toEqual(ends.map((e) => e.slice(5, -1)).sort());
  });

  it('is what the sample option creates: a project titled after the template', () => {
    expect(projectPayloadFromPaste(SAMPLE_ARTICLE_TEX)?.title).toBe(
      'Convergence of Gradient Descent on Smooth Convex Functions'
    );
    expect(projectPayloadFromPaste(SAMPLE_ARTICLE_TEX)?.content).toBe(SAMPLE_ARTICLE_TEX);
  });
});
