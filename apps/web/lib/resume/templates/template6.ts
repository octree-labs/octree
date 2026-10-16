// Rendered from resumake.io v2 template6 (MIT, (c) Saad Quadri) with sample data.
// The minimal-resume style is inlined and loads Montserrat and Crimson from TeX Live
// instead of a bundled fonts/ folder, so this is a single self-contained file.
export const skeleton = String.raw`\documentclass[10pt]{article}
    \usepackage[english]{babel}
    \usepackage[hidelinks]{hyperref}
    % ---- minimal-resume style (inlined; fonts from TeX Live) ----
% margin
\usepackage[top=1in, bottom=1in, left=1in, right=1in]{geometry}

% minimal custom packages
\usepackage[T1]{fontenc}
\usepackage{fontspec}
\usepackage[babel=true]{microtype}
\usepackage[fontsize=10.75pt]{scrextend}
\usepackage{enumitem}

\defaultfontfeatures{Ligatures=TeX}

% font families
\newfontfamily{\montserratfont}[BoldFont=Montserrat-Bold.otf]{Montserrat-Regular.otf}
\newfontfamily{\crimsonfont}[ItalicFont=Crimson-Italic.otf]{Crimson-Roman.otf}

% main font for the document
\setmainfont[ItalicFont=Crimson-Italic.otf]{Crimson-Roman.otf}

% font sizes
\newcommand{\sizeone}{1.618em}
\newcommand{\sizetwo}{1.318em}
\newcommand{\sizethree}{1em}
\newcommand{\sizefour}{0.618em}
\newcommand{\sizefive}{0.382em}
\newcommand{\sizesix}{0.236em}

% line spaces
\newcommand{\linespaceone}{1}

\newenvironment{newitemize}
  {\itemize[nolistsep,topsep=\sizefive,itemsep=\sizefive,labelsep=\sizefour,leftmargin=*]}
  {\enditemize}

\newcommand{\personal}[3]{
  \begin{center}
    % name
    {
      \fontsize{\sizeone}{\sizeone}\fontspec[LetterSpace=15]{Montserrat-Regular.otf}#1
    }\\
    % address
    \vspace{\sizethree}
    {
      \fontsize{\sizethree}{\sizethree}\fontspec[LetterSpace= 10]{Montserrat-Light.otf}#2
    }\\
    % contact
    \vspace{\sizefive}
    {
      \fontsize{\sizethree}{\sizethree}\fontspec{Montserrat-Light.otf}#3
    }
  \end{center}
}

\newcommand{\chap}[2]{
  \vspace{\sizethree}
  \raggedright
  {\hrule height 0.5pt}
  \vspace{\sizefive}
  \begin{addmargin}[\sizefive]{\sizefive}{
  {
  \fontsize{\sizefour}{\sizefour}\fontspec[LetterSpace=10]{Montserrat-Bold.otf}
  \textbf{#1}
  }
  \vspace{\sizefour}
  {#2}
  }
  \end{addmargin}
}

\newcommand{\subchap}[3]{
  \vspace{\sizefive}
  {\fontsize{\sizetwo}{\sizetwo}\fontspec{Crimson-Semibold.otf} #1} \hfill {\fontsize{\sizetwo}{\sizetwo}\fontspec{Crimson-Roman.otf} #2}
  {#3}
  \vspace{\sizefive}
}

\newcommand{\school}[5]{
  \vspace{\sizefive}
  {\fontsize{\sizetwo}{\sizetwo}\fontspec{Crimson-Semibold.otf} #1} \hfill {\fontsize{\sizethree}{\sizethree}\fontspec{Crimson-Roman.otf} #2}

  {\fontsize{\sizethree}{\sizethree}\fontspec{Crimson-Roman.otf} #3}\hfill{\fontsize{\sizethree}{\sizethree}\fontspec{Crimson-Roman.otf}#4}\\#5
  \vspace{\sizefive}
}

\newcommand{\job}[5]{
  \vspace{\sizefive}
  {\fontsize{\sizetwo}{\sizetwo}\fontspec{Crimson-Semibold.otf} #1} \hfill {\fontsize{\sizethree}{\sizethree}\fontspec{Crimson-Roman.otf} #2}

  {\fontsize{\sizethree}{\sizethree}\fontspec{Crimson-Roman.otf} #3} \hfill {\fontsize{\sizethree}{\sizethree}\fontspec{Crimson-Roman.otf} #4}
  {#5}
  \vspace{\sizefive}
}

\newcommand{\project}[4]{
  \vspace{\sizefive}
  {\fontsize{\sizetwo}{\sizetwo}\fontspec{Crimson-Semibold.otf} #1} {\fontsize{\sizethree}{\sizethree}\fontspec{Crimson-Roman.otf} #2} \hfill {\fontsize{\sizethree}{\sizethree}\fontspec{Crimson-Roman.otf} #3}
  \\#4
  \vspace{\sizefive}
}

\newcommand{\award}[4]{
  \vspace{\sizefive}
  {\fontsize{\sizetwo}{\sizetwo}\fontspec{Crimson-Semibold.otf} #1} \hfill {\fontsize{\sizethree}{\sizethree}\fontspec{Crimson-Roman.otf} #2}

  {\fontsize{\sizethree}{\sizethree}\fontspec{Crimson-Roman.otf} #3} \hfill {\fontsize{\sizethree}{\sizethree}\fontspec{Crimson-Roman.otf} #4}
  \vspace{\sizefive}
}
\pagenumbering{gobble}
% ---- end style ----
    \begin{document}
    \begin{center}
% Personal
% -----------------------------------------------------
{\fontsize{\sizeone}{\sizeone}\fontspec[LetterSpace=15]{Montserrat-Regular.otf} JANE DOE}
\\
\vspace{2mm}
{\fontsize{1em}{1em}\fontspec{Montserrat-Light.otf} jane@example.com -- (555) 123-4567 -- San Francisco, CA -- \href{https://janedoe.dev}{https://janedoe.dev}}
\end{center}
% Chapter: Education
      % ------------------

      \chap{EDUCATION}{

      \school
    {State University}
    {Aug 2016 – May 2020}
    {B.S. Computer Science}
    {Austin, TX}
    {\begin{newitemize}
        \item GPA: 3.8
      \end{newitemize}
}
      }
% Chapter: Work Experience
      % ------------------------
      \chap{EXPERIENCE}{

      \job
            {Acme Corp}
            {Jun 2020 – Present}
            {Software Engineer}
            {San Francisco, CA}
            {\begin{newitemize}
  \item {Built a real-time analytics pipeline that cut report latency by 30\%}
  \item {Led migration of the monolith to containerized services on Kubernetes}
  \item {Mentored four junior engineers through onboarding}
\end{newitemize}}
      \job
            {Initech}
            {May 2019 – Aug 2019}
            {Software Engineering Intern}
            {Remote}
            {\begin{newitemize}
  \item {Shipped an internal dashboard used by 200+ employees}
  \item {Wrote integration tests raising coverage from 55\% to 80\%}
\end{newitemize}}
    }
% Chapter: Skills
% ------------------------

\chap{SKILLS}{
\begin{newitemize}
  \item Languages: TypeScript, Python, Go, SQL
  \item Tools: Docker, Kubernetes, Postgres, AWS
\end{newitemize}
}
% Chapter: Projects
    % ------------------------

    \chap{PROJECTS}{

      \project
{Open Source CLI}
{Go, Cobra}
{\href{https://github.com/jane/dots}{https://github.com/jane/dots}}
{Command-line tool for managing dotfiles\\}
    }
% Chapter: Awards
    % ------------------------

    \chap{AWARDS}{

      \award
{Hackathon Winner}
{2019}
{First place out of 100 teams}
{HackTX}
    }
    \ 
    \end{document}`;
