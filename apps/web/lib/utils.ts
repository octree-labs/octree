import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import axios from 'axios';
import type { CompilationError } from '@/types/compilation';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getBaseUrl = () => {
  return process.env.ENVIRONMENT === 'dev'
    ? 'http://localhost:3000'
    : 'https://app.useoctree.com';
};

export const initialContent = `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\title{Sample LaTeX Document with Equations}
\\author{Basil Yusuf}
\\date{18th Jan, 1991}

\\begin{document}

\\maketitle

\\section{Introduction}
This is a sample LaTeX document containing various equations to test your LaTeX to HTML compiler.

\\section{Simple Equations}
Here is a simple inline equation: $E = mc^2$. This famous equation relates energy and mass.

Here is a displayed equation:
\\begin{equation}
    F = G \\frac{m_1 m_2}{r^2}
\\end{equation}

\\section{More Complex Equations}
The quadratic formula for solving $ax^2 + bx + c = 0$ is:
\\begin{equation}
    x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
\\end{equation}

The binomial theorem provides the expansion:
\\begin{equation}
    (x + y)^n = \\sum_{k=0}^{n} \\binom{n}{k} x^{n-k} y^k
\\end{equation}

Maxwell's equations in differential form include:
\\begin{align}
    \\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} \\\\
    \\nabla \\cdot \\mathbf{B} &= 0 \\\\
    \\nabla \\times \\mathbf{E} &= -\\frac{\\partial \\mathbf{B}}{\\partial t} \\\\
    \\nabla \\times \\mathbf{B} &= \\mu_0 \\mathbf{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}
\\end{align}

\\section{Advanced Mathematical Notation}
The infinite series for $e^x$ is given by:
\\begin{equation}
    e^x = \\sum_{n=0}^{\\infty} \\frac{x^n}{n!} = 1 + x + \\frac{x^2}{2!} + \\frac{x^3}{3!} + \\cdots
\\end{equation}

The definition of an integral:
\\begin{equation}
    \\int_{a}^{b} f(x) \\, dx = \\lim_{n \\to \\infty} \\sum_{i=1}^{n} f(x_i^*) \\Delta x
\\end{equation}

\\end{document}`;

export function formatCompilationErrorForAI(error: CompilationError): string {
  const errorContext = [
    `LaTeX Compilation Error:`,
    `${error.message}`,
    error.details && `\nDetails: ${error.details}`,
    error.summary && `\nError Summary:\n${error.summary}`,
    error.log &&
      `\nLog (last lines):\n${error.log.split('\n').slice(-20).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n');

  return errorContext;
}

export function formatCompilationErrorForClipboard(
  error: CompilationError
): string {
  const errorText = [
    `Error: ${error.message}`,
    error.details && `Details: ${error.details}`,
    error.requestId && `Request ID: ${error.requestId}`,
    typeof error.queueMs === 'number' && `Queue: ${error.queueMs}ms`,
    typeof error.durationMs === 'number' && `Duration: ${error.durationMs}ms`,
    error.summary && `Summary:\n${error.summary}`,
    error.log && `Log:\n${error.log}`,
    error.stdout && `Output:\n${error.stdout}`,
    error.stderr && `Errors:\n${error.stderr}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return errorText;
}

export const fetcher = (url: string) => axios.get(url).then((res) => res.data);
