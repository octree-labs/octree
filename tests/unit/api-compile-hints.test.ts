import { describe, it, expect } from 'vitest';
import { hintForLatexError, undefinedCommandFromContext } from '@/lib/api/compile-hints';
import { parseLatexErrors } from '@/lib/api/compile-result';

describe('undefinedCommandFromContext', () => {
  it('takes the last control sequence of the first context line', () => {
    expect(undefinedCommandFromContext('l.12 \\includegraphics')).toBe('includegraphics');
    expect(undefinedCommandFromContext('l.4 Some text \\textbf{x} \\mathbb')).toBe('mathbb');
    expect(undefinedCommandFromContext('<argument> \\foo')).toBe('foo');
    expect(undefinedCommandFromContext('\\mymacro ->\\bar')).toBe('bar');
    expect(undefinedCommandFromContext('l.3 plain text')).toBeNull();
    expect(undefinedCommandFromContext(undefined)).toBeNull();
  });
});

describe('hintForLatexError', () => {
  it('names the package for well-known undefined commands', () => {
    expect(hintForLatexError({ message: 'Undefined control sequence.', command: 'includegraphics' })).toBe(
      '\\includegraphics is provided by graphicx: add \\usepackage{graphicx} to the preamble.'
    );
    expect(hintForLatexError({ message: 'Undefined control sequence.', command: 'rowcolor' })).toBe(
      '\\rowcolor is provided by xcolor: add \\usepackage[table]{xcolor} to the preamble.'
    );
    expect(hintForLatexError({ message: 'Undefined control sequence.', command: 'mytypo' })).toMatch(/\\mytypo is not defined/);
    expect(hintForLatexError({ message: 'Undefined control sequence.' })).toMatch(/check its spelling/);
  });

  it('covers missing environments, files and packages', () => {
    expect(hintForLatexError({ message: 'LaTeX Error: Environment align undefined.' })).toMatch(/\\usepackage\{amsmath\}/);
    expect(hintForLatexError({ message: 'LaTeX Error: Environment minted undefined.' })).toMatch(/shell escape/);
    expect(hintForLatexError({ message: "LaTeX Error: File `foo.sty' not found." })).toMatch(/not part of TeX Live/);
    expect(hintForLatexError({ message: "LaTeX Error: File `chapters/one.tex' not found." })).toMatch(/add it to "files"/);
    expect(hintForLatexError({ message: "LaTeX Error: File `figure.png' not found." })).toMatch(/binary files/);
  });

  it('covers the common syntax errors', () => {
    expect(hintForLatexError({ message: 'Missing $ inserted.' })).toMatch(/math mode/);
    expect(hintForLatexError({ message: 'Missing } inserted.' })).toMatch(/Braces/);
    expect(hintForLatexError({ message: 'Misplaced alignment tab character &.' })).toMatch(/\\&/);
    expect(hintForLatexError({ message: 'LaTeX Error: Missing \\begin{document}.' })).toMatch(/before \\begin\{document\}/);
    expect(hintForLatexError({ message: 'LaTeX Error: Can be used only in preamble.' })).toMatch(/preamble/);
    expect(hintForLatexError({ message: "LaTeX Error: There's no line here to end." })).toMatch(/line break/);
    expect(hintForLatexError({ message: 'Emergency stop.' })).toMatch(/\\end\{document\}/);
    expect(
      hintForLatexError({ message: 'LaTeX Error: Unicode character ü (U+00FC) not set up for use with LaTeX.' })
    ).toMatch(/fontspec/);
    expect(hintForLatexError({ message: 'Some unrelated package error.' })).toBeUndefined();
  });
});

describe('parseLatexErrors hints', () => {
  it('reads the undefined command from the context TeX prints', () => {
    const log = [
      './main.tex:7: Undefined control sequence.',
      '<argument> \\toprule',
      '',
      'l.7 \\begin{tabular}{ll}\\mytable',
      '! LaTeX Error: Environment tikzpicture undefined.',
      'l.9 \\begin{tikzpicture}',
    ].join('\n');
    const errors = parseLatexErrors(log);
    expect(errors[0]).toMatchObject({ file: 'main.tex', line: 7, hint: expect.stringContaining('\\usepackage{booktabs}') });
    expect(errors[1]).toMatchObject({ line: 9, hint: expect.stringContaining('\\usepackage{tikz}') });
  });
});
