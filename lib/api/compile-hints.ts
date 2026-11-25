/**
 * Short, actionable fix hints for the TeX errors the public API reports
 * (lib/api/compile-result.ts). Written for AI agents: one sentence that says
 * what to change, naming the package or command when the log tells us.
 * Pure, so it is unit tested on its own.
 */

/**
 * Commands whose usual cause of "Undefined control sequence" is a missing
 * \usepackage. The value is the \usepackage argument: `graphicx`, or
 * `[table]{xcolor}` when an option is needed.
 */
const COMMAND_PACKAGES: Record<string, string> = {
  includegraphics: 'graphicx',
  graphicspath: 'graphicx',
  rotatebox: 'graphicx',
  scalebox: 'graphicx',
  resizebox: 'graphicx',
  href: 'hyperref',
  url: 'hyperref',
  hypersetup: 'hyperref',
  autoref: 'hyperref',
  textcolor: 'xcolor',
  color: 'xcolor',
  colorbox: 'xcolor',
  definecolor: 'xcolor',
  rowcolor: '[table]{xcolor}',
  cellcolor: '[table]{xcolor}',
  toprule: 'booktabs',
  midrule: 'booktabs',
  bottomrule: 'booktabs',
  cmidrule: 'booktabs',
  multirow: 'multirow',
  mathbb: 'amssymb',
  mathfrak: 'amssymb',
  checkmark: 'amssymb',
  square: 'amssymb',
  blacksquare: 'amssymb',
  varnothing: 'amssymb',
  mathscr: 'mathrsfs',
  text: 'amsmath',
  eqref: 'amsmath',
  DeclareMathOperator: 'amsmath',
  operatorname: 'amsmath',
  dfrac: 'amsmath',
  tfrac: 'amsmath',
  binom: 'amsmath',
  boldsymbol: 'amsmath',
  bm: 'bm',
  coloneqq: 'mathtools',
  SI: 'siunitx',
  si: 'siunitx',
  qty: 'siunitx',
  unit: 'siunitx',
  num: 'siunitx',
  lipsum: 'lipsum',
  blindtext: 'blindtext',
  cref: 'cleveref',
  Cref: 'cleveref',
  xspace: 'xspace',
  tikz: 'tikz',
  usetikzlibrary: 'tikz',
  captionof: 'caption',
  subcaption: 'subcaption',
  subfloat: 'subfig',
  euro: 'eurosym',
  degree: 'gensymb',
  celsius: 'gensymb',
  geometry: 'geometry',
  newgeometry: 'geometry',
  fancyhead: 'fancyhdr',
  fancyfoot: 'fancyhdr',
  lstinputlisting: 'listings',
  lstset: 'listings',
  ding: 'pifont',
  faIcon: 'fontawesome5',
  faGithub: 'fontawesome5',
  faEnvelope: 'fontawesome5',
  faLinkedin: 'fontawesome5',
  faPhone: 'fontawesome5',
  setstretch: 'setspace',
  onehalfspacing: 'setspace',
  doublespacing: 'setspace',
  titleformat: 'titlesec',
  titlespacing: 'titlesec',
  setlist: 'enumitem',
  citep: 'natbib',
  citet: 'natbib',
  printbibliography: 'biblatex',
  addbibresource: 'biblatex',
  ifthenelse: 'ifthen',
  todo: 'todonotes',
  algorithmic: 'algpseudocode',
  State: 'algpseudocode',
  Require: 'algpseudocode',
  Ensure: 'algpseudocode',
  If: 'algpseudocode',
  For: 'algpseudocode',
};

/** Environments whose "Environment x undefined" usually means a missing package. */
const ENVIRONMENT_PACKAGES: Record<string, string> = {
  align: 'amsmath',
  'align*': 'amsmath',
  gather: 'amsmath',
  'gather*': 'amsmath',
  multline: 'amsmath',
  'multline*': 'amsmath',
  split: 'amsmath',
  cases: 'amsmath',
  pmatrix: 'amsmath',
  bmatrix: 'amsmath',
  vmatrix: 'amsmath',
  matrix: 'amsmath',
  proof: 'amsthm',
  tikzpicture: 'tikz',
  axis: 'pgfplots',
  lstlisting: 'listings',
  algorithm: 'algorithm',
  algorithmic: 'algpseudocode',
  subfigure: 'subcaption',
  tabularx: 'tabularx',
  longtable: 'longtable',
  multicols: 'multicol',
  wrapfigure: 'wrapfig',
  landscape: 'pdflscape',
  minted: 'minted',
  tcolorbox: 'tcolorbox',
  spacing: 'setspace',
};

export interface HintInput {
  message: string;
  /** The undefined command (without the backslash), when the log shows it. */
  command?: string | null;
}

function packageHint(pkg: string, what: string): string {
  const usepackage = pkg.startsWith('[') ? `\\usepackage${pkg}` : `\\usepackage{${pkg}}`;
  const name = pkg.replace(/^\[[^\]]*\]\{|\}$/g, '');
  return `${what} is provided by ${name}: add ${usepackage} to the preamble.`;
}

/** A one-sentence fix hint for one TeX error, or undefined when there is nothing better than the message. */
export function hintForLatexError({ message, command }: HintInput): string | undefined {
  const text = message.trim();

  if (/undefined control sequence/i.test(text)) {
    if (command) {
      const pkg = COMMAND_PACKAGES[command];
      if (pkg) return packageHint(pkg, `\\${command}`);
      return `\\${command} is not defined: check its spelling, define it with \\newcommand, or load the package that provides it.`;
    }
    return 'A command is not defined: check its spelling, or add the \\usepackage that provides it.';
  }

  const environment = /Environment (\S+) undefined/i.exec(text);
  if (environment) {
    const name = environment[1];
    if (name === 'minted') {
      return 'minted needs shell escape, which is disabled on Octree: use the listings package (lstlisting) instead.';
    }
    const pkg = ENVIRONMENT_PACKAGES[name];
    if (pkg) return packageHint(pkg, `The ${name} environment`);
    if (name === 'theorem' || name === 'lemma' || name === 'definition' || name === 'corollary') {
      return `Declare the ${name} environment with \\newtheorem{${name}}{...} (amsthm) in the preamble.`;
    }
    return `The ${name} environment is not defined: check its spelling or load the package that provides it.`;
  }

  const missingFile = /File [`']([^']+)' not found/i.exec(text);
  if (missingFile) {
    const file = missingFile[1];
    if (/\.(sty|cls)$/i.test(file)) {
      return `${file} is not part of TeX Live: check the name for typos, or send your own ${file} in "files" next to main.tex.`;
    }
    if (/\.(png|jpe?g|pdf|eps|svg|gif)$/i.test(file)) {
      return `${file} is missing: binary files such as images are not supported by the API yet, so remove the \\includegraphics or replace it with a placeholder (e.g. the [demo] option of graphicx, or a \\rule).`;
    }
    return `${file} is missing: add it to "files" with the same relative path used in \\input/\\include.`;
  }
  if (/Unable to load picture or PDF file|cannot determine size of graphic|Cannot determine size of graphic/i.test(text)) {
    return 'An image file is missing or unreadable: binary files are not supported by the API yet, so remove or replace the \\includegraphics.';
  }

  if (/missing \$ inserted/i.test(text)) {
    return 'A math-only command or character (_, ^, \\alpha, ...) is used outside math mode: wrap it in $...$, or escape it in text (\\_ , \\^{}).';
  }
  if (/display math should end with \$\$|bad math environment delimiter/i.test(text)) {
    return 'Math delimiters are unbalanced: check that every $, \\[ and \\( is closed.';
  }
  if (/missing [{}] inserted|too many }'s|extra }, or forgotten|runaway argument|paragraph ended before .* was complete/i.test(text)) {
    return 'Braces are unbalanced near the reported line: check that every { has a matching } and no command argument spans a blank line.';
  }
  if (/\\begin\{([^}]+)\} on input line \d+ ended by \\end\{([^}]+)\}/i.test(text)) {
    return 'An environment is closed with the wrong \\end: make each \\begin{x} end with \\end{x}, in order.';
  }
  if (/misplaced alignment tab character &/i.test(text)) {
    return 'A bare & is used outside a table: write \\& in text.';
  }
  if (/missing \\begin\{document\}/i.test(text)) {
    return 'Text appears before \\begin{document}: move it into the body, or check for a stray character in the preamble.';
  }
  if (/can be used only in preamble/i.test(text)) {
    return 'A preamble-only command (e.g. \\usepackage) is used after \\begin{document}: move it above \\begin{document}.';
  }
  if (/option clash for package (\S+)/i.test(text)) {
    return 'The same package is loaded twice with different options: load it once with all the options, or use \\PassOptionsToPackage before \\documentclass.';
  }
  if (/there's no line here to end/i.test(text)) {
    return 'A \\\\ line break has no line to end (e.g. right after a blank line or at the start of a list item): remove it or use \\vspace.';
  }
  if (/unicode character .* not set up for use with latex/i.test(text)) {
    return 'A Unicode character is not supported by pdfLaTeX: replace it with a LaTeX command, or load fontspec (the compile switches to XeLaTeX automatically).';
  }
  if (/no legal \\end found|\\end occurred inside a group|emergency stop/i.test(text)) {
    return 'The document ends early: check that \\end{document} is present and every environment and group is closed.';
  }
  if (/lonely \\item|perhaps a missing \\item/i.test(text)) {
    return '\\item is used outside a list, or a list has no \\item: put items inside itemize/enumerate/description.';
  }
  if (/illegal unit of measure/i.test(text)) {
    return 'A length is missing its unit: write e.g. 2cm, 10pt or 0.5\\textwidth.';
  }
  if (/shell escape|write18/i.test(text)) {
    return 'Shell escape is disabled on Octree: avoid packages that run external programs (minted, svg, gnuplottex, epstopdf on the fly).';
  }
  if (/undefined citation|citation .* undefined/i.test(text)) {
    return 'A \\cite key is not in the bibliography: check the key, and send the .bib file in "files".';
  }
  return undefined;
}

/**
 * The undefined command from the first context line TeX prints after the
 * error (`l.12 \foo`, `<argument> \foo`, `\mymacro ->\foo`): TeX breaks
 * that line right after the offending token, so it is the last control
 * sequence on it.
 */
export function undefinedCommandFromContext(context: string | undefined): string | null {
  if (!context) return null;
  const matches = context.match(/\\([A-Za-z@]+|.)/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1].slice(1);
  return /^[A-Za-z@]+$/.test(last) ? last : null;
}
