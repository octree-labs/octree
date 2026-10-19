/**
 * The "Start from a sample document" template for new users: a short, real
 * article (abstract, theorem, numbered equations, a booktabs table) with
 * nothing to fill in, so the first compile succeeds and the first AI edit has
 * something concrete to act on. No \includegraphics, so it needs no assets.
 * Verified with tectonic; every package is in a standard pdflatex TeX Live.
 */
export const SAMPLE_ARTICLE_TITLE = 'Sample article: gradient descent';

export const SAMPLE_ARTICLE_TEX = String.raw`\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb,amsthm}
\newtheorem{theorem}{Theorem}
\usepackage{booktabs}
\usepackage[margin=1in]{geometry}

\title{Convergence of Gradient Descent on Smooth Convex Functions}
\author{Your Name}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
We review the classical convergence rate of gradient descent on functions that are convex and have Lipschitz-continuous gradients. The main result is an $O(1/k)$ bound on the suboptimality after $k$ iterations, followed by a small numerical illustration.
\end{abstract}

\section{Introduction}
Gradient descent is the simplest first-order method for minimising a differentiable function $f : \mathbb{R}^d \to \mathbb{R}$. Starting from a point $x_0$, it produces the iterates
\begin{equation}
  x_{k+1} = x_k - \eta \nabla f(x_k), \qquad k = 0, 1, 2, \dots
  \label{eq:gd}
\end{equation}
where $\eta > 0$ is the step size. Despite its simplicity, the method enjoys clean guarantees under mild assumptions, which we state next.

\section{Assumptions and main result}
We say that $f$ is \emph{$L$-smooth} if its gradient is Lipschitz continuous with constant $L$, that is,
\begin{equation}
  \lVert \nabla f(x) - \nabla f(y) \rVert \le L \lVert x - y \rVert \quad \text{for all } x, y \in \mathbb{R}^d.
\end{equation}

\begin{theorem}
Let $f$ be convex and $L$-smooth with a minimiser $x^\star$. If gradient descent \eqref{eq:gd} is run with $\eta = 1/L$, then for every $k \ge 1$
\begin{equation}
  f(x_k) - f(x^\star) \le \frac{L \lVert x_0 - x^\star \rVert^2}{2k}.
  \label{eq:rate}
\end{equation}
\end{theorem}

\begin{proof}[Proof sketch]
Smoothness gives the descent lemma $f(x_{k+1}) \le f(x_k) - \frac{1}{2L}\lVert \nabla f(x_k) \rVert^2$, and convexity gives $f(x_k) - f(x^\star) \le \langle \nabla f(x_k), x_k - x^\star \rangle$. Combining the two and telescoping the resulting inequality over $k$ steps yields \eqref{eq:rate}.
\end{proof}

\section{Numerical illustration}
Table~\ref{tab:quadratic} reports the suboptimality of gradient descent on the quadratic $f(x) = \tfrac{1}{2} x^\top A x$ with $L = 10$ and $\lVert x_0 \rVert = 1$, alongside the bound from \eqref{eq:rate}.

\begin{table}[ht]
  \centering
  \begin{tabular}{rrr}
    \toprule
    Iteration $k$ & $f(x_k) - f(x^\star)$ & Bound \eqref{eq:rate} \\
    \midrule
    1   & 0.4050 & 5.0000 \\
    10  & 0.0349 & 0.5000 \\
    100 & 0.0004 & 0.0500 \\
    \bottomrule
  \end{tabular}
  \caption{Observed suboptimality versus the theoretical $O(1/k)$ bound.}
  \label{tab:quadratic}
\end{table}

\section{Conclusion}
The $O(1/k)$ rate is tight for the class of smooth convex functions. Adding strong convexity improves it to a linear rate, and Nesterov's acceleration improves the smooth convex rate to $O(1/k^2)$; both extensions follow the same proof pattern.

\end{document}
`;
