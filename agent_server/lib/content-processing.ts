/**
 * Content processing utilities for LaTeX documents
 */

export interface ProjectFileContext {
  path: string;
  content: string;
}

const MAX_FULL_CONTENT_FILES = 3;
const MAX_TOTAL_CONTENT_SIZE = 20000;

function extractReferencedFiles(content: string): string[] {
  const references: string[] = [];
  const patterns = [
    /\\input\{([^}]+)\}/g,
    /\\include\{([^}]+)\}/g,
    /\\bibliography\{([^}]+)\}/g,
    /\\addbibresource\{([^}]+)\}/g,
    /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const filePath = match[1].trim();
      if (!filePath.includes('.')) {
        references.push(`${filePath}.tex`);
        references.push(`${filePath}.bib`);
      } else {
        references.push(filePath);
      }
    }
  }

  return [...new Set(references)];
}

export function filterProjectFilesIntelligently(
  projectFiles: ProjectFileContext[],
  currentFilePath: string | null
): { fullContentFiles: ProjectFileContext[]; summaryFiles: string[] } {
  if (projectFiles.length === 0) {
    return { fullContentFiles: [], summaryFiles: [] };
  }

  if (projectFiles.length <= MAX_FULL_CONTENT_FILES) {
    const totalSize = projectFiles.reduce((sum, f) => sum + f.content.length, 0);
    if (totalSize <= MAX_TOTAL_CONTENT_SIZE) {
      return { fullContentFiles: projectFiles, summaryFiles: [] };
    }
  }

  const fullContentFiles: ProjectFileContext[] = [];
  const summaryFiles: string[] = [];
  let totalSize = 0;

  const currentFile = projectFiles.find(f => f.path === currentFilePath);
  if (currentFile) {
    fullContentFiles.push(currentFile);
    totalSize += currentFile.content.length;
  }

  const mainFileNames = ['main.tex', 'document.tex', 'paper.tex', 'thesis.tex', 'report.tex'];
  for (const mainName of mainFileNames) {
    if (totalSize >= MAX_TOTAL_CONTENT_SIZE) break;
    const mainFile = projectFiles.find(f =>
      f.path === mainName && f.path !== currentFilePath
    );
    if (mainFile && !fullContentFiles.includes(mainFile)) {
      fullContentFiles.push(mainFile);
      totalSize += mainFile.content.length;
    }
  }

  if (currentFile) {
    const referencedPaths = extractReferencedFiles(currentFile.content);
    for (const refPath of referencedPaths) {
      if (totalSize >= MAX_TOTAL_CONTENT_SIZE) break;
      const refFile = projectFiles.find(f =>
        f.path === refPath ||
        f.path.endsWith(`/${refPath}`) ||
        f.path.endsWith(refPath)
      );
      if (refFile && !fullContentFiles.includes(refFile)) {
        fullContentFiles.push(refFile);
        totalSize += refFile.content.length;
      }
    }
  }

  const bibFiles = projectFiles.filter(f =>
    f.path.endsWith('.bib') && !fullContentFiles.includes(f)
  );
  for (const bibFile of bibFiles) {
    if (totalSize >= MAX_TOTAL_CONTENT_SIZE) break;
    fullContentFiles.push(bibFile);
    totalSize += bibFile.content.length;
  }

  for (const file of projectFiles) {
    if (!fullContentFiles.includes(file)) {
      summaryFiles.push(file.path);
    }
  }

  return { fullContentFiles, summaryFiles };
}

export async function buildNumberedContent(fileContent: string, textFromEditor?: string | null): Promise<string> {
  return new Promise((resolve) => {
    setImmediate(() => {
      const lines = fileContent.split('\n');
      const MAX_LINES_FULL_CONTEXT = 300;

      if (lines.length <= MAX_LINES_FULL_CONTEXT) {
        const numbered = lines
          .map((line, index) => `${index + 1}: ${line}`)
          .join('\n');
        resolve(numbered);
        return;
      }

      const LINES_PER_SECTION = 75;
      const startLines = lines
        .slice(0, LINES_PER_SECTION)
        .map((line, index) => `${index + 1}: ${line}`)
        .join('\n');
      const endLines = lines
        .slice(-LINES_PER_SECTION)
        .map((line, index) => `${lines.length - LINES_PER_SECTION + index + 1}: ${line}`)
        .join('\n');

      let numbered = `${startLines}\n\n... [${lines.length - LINES_PER_SECTION * 2} lines omitted] ...\n\n${endLines}`;
      if (textFromEditor && textFromEditor.length > 0) {
        numbered += `\n\n[Selected region context will be provided separately]`;
      }
      resolve(numbered);
    });
  });
}

export function normalizeLineEndings(text: string): string {
  return text.split('\r\n').join('\n').split('\r').join('\n');
}

export function validateApiKeys(): { isValid: boolean; error?: string } {
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  if (!hasAnthropic) {
    return {
      isValid: false,
      error: 'No Anthropic API key configured. Please set ANTHROPIC_API_KEY.',
    };
  }
  return { isValid: true };
}

/**
 * Build system prompt for the AI agent — rewritten for string-matching edit tool
 */
export function buildSystemPrompt(
  numberedContent: string,
  textFromEditor?: string | null,
  selectionRange?: { startLineNumber: number; endLineNumber: number } | null,
  projectFiles?: ProjectFileContext[] | null,
  currentFilePath?: string | null,
  sessionSummary?: string | null,
  lastInteraction?: { userRequest: string; assistantResponse: string } | null
): string {
  const validProjectFiles =
    projectFiles?.filter(
      (file): file is ProjectFileContext =>
        !!file && typeof file.path === 'string' && typeof file.content === 'string'
    ) ?? [];

  const otherFiles = validProjectFiles.filter(f => f.path !== currentFilePath);

  let projectSection = '';
  if (otherFiles.length > 0) {
    const { fullContentFiles, summaryFiles } = filterProjectFilesIntelligently(
      otherFiles,
      currentFilePath ?? null
    );

    if (fullContentFiles.length > 0) {
      const fileBlocks = fullContentFiles.map(f => {
        const numbered = f.content.split('\n').map((line, idx) => `${idx + 1}: ${line}`).join('\n');
        return `--- ${f.path} ---\n${numbered}\n--- end ${f.path} ---`;
      }).join('\n\n');
      projectSection = `\n\nOTHER PROJECT FILES:\n${fileBlocks}`;
    }

    if (summaryFiles.length > 0) {
      projectSection += `\n\nAdditional files available (use get_context tool to fetch content before editing):\n${summaryFiles.map(path => `- ${path}`).join('\n')}`;
    }
  }

  const hasMultipleFiles = validProjectFiles.length > 1;
  const multiFileInstructions = hasMultipleFiles ? `\n\nMULTI-FILE PROJECTS:
- The currently open file is: ${currentFilePath || 'unknown'}
- To edit OTHER files: First call get_context to see the file's content, then use the edit tool with the correct file_path.
- ALWAYS specify the correct file_path for each edit.` : '';

  let sessionContext = '';
  if (sessionSummary || lastInteraction) {
    sessionContext = `\n\nEDITING SESSION CONTEXT:`;
    if (sessionSummary) {
      sessionContext += `\nSession summary (ongoing goals and changes):\n${sessionSummary}`;
    }
    if (lastInteraction) {
      sessionContext += `\n\nLast interaction:\nUser: ${lastInteraction.userRequest}\nAssistant: ${lastInteraction.assistantResponse.substring(0, 500)}${lastInteraction.assistantResponse.length > 500 ? '...' : ''}`;
    }
    sessionContext += `\n---\nUse this context to resolve references (e.g., "the table", "that figure") and understand what was just done.`;
  }

  return `You are Octra, a LaTeX editing assistant. You edit LaTeX documents by calling the 'edit' tool.

ABSOLUTE RULE: For ANY editing request, you MUST:
1. Immediately call the 'edit' tool with the edit
2. NEVER explain what should be done manually
3. NEVER say you're "encountering issues" - just call the tool

THE EDIT TOOL uses string matching:
- To REPLACE text: { file_path: "file.tex", old_string: "exact text to find", new_string: "replacement text" }
- To INSERT text: { file_path: "file.tex", old_string: "", new_string: "text to append" }
- To DELETE text: { file_path: "file.tex", old_string: "exact text to remove", new_string: "" }

IMPORTANT RULES:
- old_string must match EXACTLY one location in the file (including whitespace and newlines)
- Include enough context in old_string to make it unique
- For multi-line edits, include the full block of lines
- Make one edit tool call per change (you can make multiple calls for multiple changes)
- Each edit is applied immediately — subsequent edits must use old_string values that reflect prior changes, not the original file
${multiFileInstructions}${sessionContext}

EXAMPLES:

User: "add a title"
You: [Call edit with old_string="" to append, or with old_string matching the line AFTER where you want to insert]

User: "remove the introduction"
You: [Call edit with old_string matching the intro section, new_string=""]

User: "fix the equation"
You: [Call edit with old_string matching the broken equation, new_string with the fixed version]

COMPILE TOOL:
- After making edits, call 'compile' to verify the LaTeX compiles correctly
- If compilation fails, read the error log, fix the issues with the edit tool, and compile again
- Iterate until compilation succeeds or you've identified an issue you cannot fix

WORKFLOW:
1. User asks for edit → You call edit immediately
2. Tool returns success → Call compile to verify
3. If compile fails → Read log, fix with edit, compile again
4. When done → Briefly say what you did

The file content is shown below with line numbers for reference only. Your edits use exact string matching, NOT line numbers.

---
${numberedContent}
---${textFromEditor ? `\n\nSelected text:\n---\n${textFromEditor}\n---` : ''}${selectionRange ? `\n\nSelection: lines ${selectionRange.startLineNumber}-${selectionRange.endLineNumber}` : ''}${projectSection}`;
}
