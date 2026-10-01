// Rendered from resumake.io v2 template1 (MIT, (c) Saad Quadri) with sample data.
export const skeleton = String.raw`\documentclass[a4paper]{article}
    \usepackage{fullpage}
    \usepackage{amsmath}
    \usepackage{amssymb}
    \usepackage{textcomp}
    \usepackage[utf8]{inputenc}
    \usepackage[T1]{fontenc}
    \textheight=10in
    \pagestyle{empty}
    \raggedright
    \usepackage[left=0.8in,right=0.8in,bottom=0.8in,top=0.8in]{geometry}
    \usepackage[hidelinks]{hyperref}

    %\renewcommand{\encodingdefault}{cg}
%\renewcommand{\rmdefault}{lgrcmr}

\def\bull{\vrule height 0.8ex width .7ex depth -.1ex }

% DEFINITIONS FOR RESUME %%%%%%%%%%%%%%%%%%%%%%%

\newcommand{\area} [2] {
    \vspace*{-9pt}
    \begin{verse}
        \textbf{#1}   #2
    \end{verse}
}

\newcommand{\lineunder} {
    \vspace*{-8pt} \\
    \hspace*{-18pt} \hrulefill \\
}

\newcommand{\header} [1] {
    {\hspace*{-18pt}\vspace*{6pt} \textsc{#1}}
    \vspace*{-6pt} \lineunder
}

\newcommand{\employer} [3] {
    { \textbf{#1} (#2)\\ \underline{\textbf{\emph{#3}}}\\  }
}

\newcommand{\contact} [3] {
    \vspace*{-10pt}
    \begin{center}
        {\Huge \scshape {#1}}\\
        #2 \\ #3
    \end{center}
    \vspace*{-8pt}
}

\newenvironment{achievements}{
    \begin{list}
        {$\bullet$}{\topsep 0pt \itemsep -2pt}}{\vspace*{4pt}
    \end{list}
}

\newcommand{\schoolwithcourses} [4] {
    \textbf{#1} #2 $\bullet$ #3\\
    #4 \\
    \vspace*{5pt}
}

\newcommand{\school} [4] {
    \textbf{#1} #2 $\bullet$ #3\\
    #4 \\
}
% END RESUME DEFINITIONS %%%%%%%%%%%%%%%%%%%%%%%

    \begin{document}
    \vspace*{-40pt}

    %==== Profile ====%
\vspace*{-10pt}
\begin{center}
  {\Huge \scshape {Jane Doe}}\\
  San Francisco, CA $\cdot$ jane@example.com $\cdot$ (555) 123-4567 $\cdot$ \href{https://janedoe.dev}{https://janedoe.dev}\\
\end{center}

%==== Education ====%
      \header{Education}
      \textbf{State University}\hfill Austin, TX\\
B.S. Computer Science \textit{GPA: 3.8} \hfill Aug 2016 - May 2020\\
\vspace{2mm}

%==== Experience ====%
      \header{Experience}
      \vspace{1mm}

      \textbf{Acme Corp} \hfill San Francisco, CA\\
          \textit{Software Engineer} \hfill Jun 2020 - Present\\
          \vspace{-1mm}
\begin{itemize} \itemsep 1pt
  \item Built X that improved Y by 30\%
  \item Led migration of Z to W
\end{itemize}
      \textbf{Initech} \hfill Remote\\
          \textit{Intern} \hfill May 2019 - Aug 2019\\
          \vspace{-1mm}
\begin{itemize} \itemsep 1pt
  \item Did A
  \item Did B
\end{itemize}

\header{Skills}
\begin{tabular}{ l l }
Languages: & TypeScript, Python, Go \\
Tools: & Docker, Postgres \\
\end{tabular}
\vspace{2mm}

\header{Projects}
      {\textbf{Project One}} {\sl React, Node} \hfill \href{https://github.com/jane/one}{https://github.com/jane/one}\\
Short description\\
\vspace*{2mm}

\header{Awards}
      \textbf{Hackathon Winner} \hfill HackTX\\
First place out of 100 teams \hfill 2019\\
\vspace*{2mm}

    \ 
    \end{document}`;
