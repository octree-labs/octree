import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  aiEditRequestedKey,
  collectNudgeSource,
  hasAbstract,
  hasCitations,
  hasRequestedAiEdit,
  markAiEditRequested,
  markNudgeShown,
  nudgeShownKey,
  pickNudgeSuggestions,
  shouldShowFirstEditNudge,
  stripLatexComments,
  usageShowsEdits,
  wasNudgeShown,
} from '@/lib/first-edit-nudge';
import { FirstEditNudge } from '@/components/editor/first-edit-nudge';
import { FREE_DAILY_EDIT_LIMIT } from '@/data/constants';

const ids = (latex: string) => pickNudgeSuggestions(latex).map((s) => s.id);

describe('pickNudgeSuggestions', () => {
  it('always leads with the formatting prompt and offers exactly three', () => {
    const picked = pickNudgeSuggestions('\\documentclass{article}\\begin{document}Hi\\end{document}');
    expect(picked).toHaveLength(3);
    expect(picked[0]).toMatchObject({ id: 'fix_formatting', prompt: 'Fix formatting and spacing' });
    for (const s of picked) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.prompt.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the introduction and a table of contents for a plain document', () => {
    expect(ids('\\section{Introduction} Hello.')).toEqual([
      'fix_formatting',
      'tighten_introduction',
      'add_toc',
    ]);
  });

  it('offers the abstract prompt when the document has one', () => {
    expect(ids('\\begin{abstract}We study things.\\end{abstract}')).toEqual([
      'fix_formatting',
      'tighten_abstract',
      'add_toc',
    ]);
    expect(hasAbstract('\\begin {abstract}')).toBe(true);
    expect(hasAbstract('\\section{Abstract}')).toBe(false);
  });

  it('ignores commented-out abstracts and citations', () => {
    expect(hasAbstract('% \\begin{abstract} is commented out')).toBe(false);
    expect(hasAbstract('text % \\begin{abstract}')).toBe(false);
    expect(hasAbstract('%\\begin{abstract}\n\\begin{abstract}')).toBe(true);
    expect(hasCitations('% \\cite{a}\n% \\bibliography{refs}')).toBe(false);
    expect(hasCitations('100\\% sure \\cite{a}')).toBe(true);
    expect(stripLatexComments('a % b\nc \\% d % e')).toBe('a \nc \\% d ');
    expect(ids('% \\begin{abstract}\n% \\cite{x}')).toEqual([
      'fix_formatting',
      'tighten_introduction',
      'add_toc',
    ]);
  });

  it('offers the citations prompt for \\cite and friends or a bibliography', () => {
    expect(ids('As shown in \\cite{knuth84}.')).toContain('check_citations');
    expect(ids('As shown in \\citep[p.~3]{knuth84}.')).toContain('check_citations');
    expect(ids('\\autocite{knuth84}')).toContain('check_citations');
    expect(ids('\\citet{knuth84}')).toContain('check_citations');
    expect(ids('\\parencite{knuth84}')).toContain('check_citations');
    expect(ids('\\textcite{knuth84}')).toContain('check_citations');
    expect(ids('\\cite*{knuth84}')).toContain('check_citations');
    expect(ids('\\nocite{*}')).toContain('check_citations');
    expect(ids('\\bibliography{refs}')).toContain('check_citations');
    expect(ids('\\addbibresource{refs.bib}')).toContain('check_citations');
    expect(ids('\\addbibresource[datatype=bibtex]{refs.bib}')).toContain('check_citations');
    expect(ids('\\printbibliography')).toContain('check_citations');
    expect(ids('\\printbibliography[heading=none]')).toContain('check_citations');
    expect(hasCitations('\\usepackage{natbib} \\bibliographystyle{plain}')).toBe(false);
    expect(hasCitations('\\section{Citations} none here')).toBe(false);
    expect(hasCitations('\\printbibliographyX')).toBe(false);
  });

  it('combines both signals', () => {
    expect(ids('\\begin{abstract}x\\end{abstract} \\cite{a}')).toEqual([
      'fix_formatting',
      'tighten_abstract',
      'check_citations',
    ]);
  });

  it('copes with empty content', () => {
    expect(ids('')).toEqual(['fix_formatting', 'tighten_introduction', 'add_toc']);
  });
});

describe('collectNudgeSource', () => {
  const main = '\\documentclass{article}\\begin{document}\\input{intro}\\end{document}';

  it('leads with main.tex and takes the open file from the editor', () => {
    const source = collectNudgeSource(
      [
        { path: 'intro.tex', content: 'saved intro' },
        { path: 'main.tex', content: 'stale main' },
        { path: 'refs.bib', content: '@article{a}' },
      ],
      'main.tex',
      main
    );
    expect(source.startsWith(main)).toBe(true);
    expect(source).toContain('saved intro');
    expect(source).not.toContain('stale main');
    expect(source).not.toContain('@article');
  });

  it('falls back to the one file with \\documentclass, then to the open file', () => {
    expect(
      collectNudgeSource(
        [
          { path: 'sections/intro.tex', content: 'intro' },
          { path: 'paper.tex', content: main },
        ],
        'sections/intro.tex',
        'edited intro'
      ).startsWith(main)
    ).toBe(true);
    expect(
      collectNudgeSource(
        [
          { path: 'a.tex', content: '\\documentclass{a}' },
          { path: 'b.tex', content: '\\documentclass{b}' },
        ],
        'b.tex',
        '\\documentclass{b} open b'
      ).startsWith('\\documentclass{b} open b')
    ).toBe(true);
    // A commented-out \documentclass does not make a file the main one.
    expect(
      collectNudgeSource(
        [
          { path: 'notes.tex', content: '% \\documentclass{article}' },
          { path: 'paper.tex', content: main },
        ],
        'notes.tex',
        '% \\documentclass{article}'
      ).startsWith(main)
    ).toBe(true);
  });

  it('uses the editor content when the project has no .tex files', () => {
    expect(collectNudgeSource([], null, 'only this')).toBe('only this');
    expect(collectNudgeSource([{ path: 'refs.bib', content: 'x' }], 'refs.bib', 'bib')).toBe('bib');
  });

  it('counts an abstract that lives in an \\input section', () => {
    const source = collectNudgeSource(
      [
        { path: 'main.tex', content: main },
        { path: 'intro.tex', content: '\\begin{abstract}x\\end{abstract}' },
      ],
      'main.tex',
      main
    );
    expect(ids(source)).toEqual(['fix_formatting', 'tighten_abstract', 'add_toc']);
  });
});

describe('shouldShowFirstEditNudge', () => {
  it('shows a never-nudged user who has never edited', () => {
    expect(shouldShowFirstEditNudge({ enabled: true, alreadyShown: false, hasEdited: false })).toBe(true);
  });

  it('never shows twice', () => {
    expect(shouldShowFirstEditNudge({ enabled: true, alreadyShown: true, hasEdited: false })).toBe(false);
  });

  it('skips anyone who has already asked for an AI edit', () => {
    expect(shouldShowFirstEditNudge({ enabled: true, alreadyShown: false, hasEdited: true })).toBe(false);
  });

  it('is off entirely behind the kill switch', () => {
    expect(shouldShowFirstEditNudge({ enabled: false, alreadyShown: false, hasEdited: false })).toBe(false);
  });
});

describe('usageShowsEdits', () => {
  it('reads either counter as proof of an edit, and nothing else', () => {
    expect(usageShowsEdits(null)).toBe(false);
    expect(usageShowsEdits({})).toBe(false);
    expect(usageShowsEdits({ editCount: 0, monthlyEditCount: 0 })).toBe(false);
    expect(usageShowsEdits({ editCount: 1 })).toBe(true);
    expect(usageShowsEdits({ monthlyEditCount: 3 })).toBe(true);
  });
});

describe('localStorage flags', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('are keyed per user', () => {
    expect(nudgeShownKey('u1')).toBe('octree:first-edit-nudge:shown:u1');
    expect(aiEditRequestedKey('u1')).toBe('octree:ai-edit-requested:u1');

    expect(wasNudgeShown('u1')).toBe(false);
    markNudgeShown('u1');
    expect(wasNudgeShown('u1')).toBe(true);
    expect(wasNudgeShown('u2')).toBe(false);

    expect(hasRequestedAiEdit('u1')).toBe(false);
    markAiEditRequested('u1');
    expect(hasRequestedAiEdit('u1')).toBe(true);
    expect(hasRequestedAiEdit('u2')).toBe(false);
  });

  it('never throw when storage is unavailable', () => {
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    try {
      expect(() => markNudgeShown('u1')).not.toThrow();
      expect(wasNudgeShown('u1')).toBe(false);
      expect(hasRequestedAiEdit('u1')).toBe(false);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe('<FirstEditNudge />', () => {
  const suggestions = pickNudgeSuggestions('\\begin{abstract}x\\end{abstract} \\cite{a}');

  it('renders the heading, the three prompts and the free allowance', () => {
    render(
      <FirstEditNudge
        suggestions={suggestions}
        onChoose={() => {}}
        onDismiss={() => {}}
        showFreeAllowance
      />
    );
    expect(screen.getByText('Your PDF is ready. Try one AI edit on it:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fix formatting and spacing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tighten my abstract' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Check my citations and references' })
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${FREE_DAILY_EDIT_LIMIT} free AI edits a day`))).toBeInTheDocument();
  });

  it('hides the allowance line for Pro users', () => {
    render(<FirstEditNudge suggestions={suggestions} onChoose={() => {}} onDismiss={() => {}} />);
    expect(screen.queryByText(/free AI edits a day/)).not.toBeInTheDocument();
  });

  it('hands the chosen suggestion back and exposes a dismiss button', () => {
    const onChoose = vi.fn();
    const onDismiss = vi.fn();
    render(<FirstEditNudge suggestions={suggestions} onChoose={onChoose} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tighten my abstract' }));
    expect(onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tighten_abstract', prompt: 'Tighten my abstract' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
