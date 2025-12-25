/**
 * Content processing utilities for LaTeX documents
 * Handles file content formatting, numbering, and text processing
 */

export interface ProjectFileContext {
  path: string;
  content: string;
}

// Maximum number of files to send with full content
const MAX_FULL_CONTENT_FILES = 3;
// Maximum total content size (in characters) to send
const MAX_TOTAL_CONTENT_SIZE = 20000;
// Maximum size per individual file (truncate if larger)
const MAX_FILE_SIZE = 8000;

/**
 * Parse LaTeX file to extract referenced files (via \input, \include, \bibliography, etc.)
 * @param content - The LaTeX file content
 * @returns Array of referenced file paths
 */
function extractReferencedFiles(content: string): string[] {
  const references: string[] = [];
  
  // Match \input{filename}, \include{filename}, \bibliography{filename}
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
      let filePath = match[1].trim();
      // Handle files without extension
      if (!filePath.includes('.')) {
        // LaTeX commonly omits .tex extension
        references.push(`${filePath}.tex`);
        references.push(`${filePath}.bib`);
      } else {
        references.push(filePath);
      }
    }
  }
  
  return [...new Set(references)]; // Remove duplicates
}

/**
 * Filter project files intelligently to reduce context size
 * Prioritizes: current file, main.tex, referenced files
 * @param projectFiles - All project files
 * @param currentFilePath - Path of the currently open file
 * @returns Filtered files with smart prioritization
 */
export function filterProjectFilesIntelligently(
  projectFiles: ProjectFileContext[],
  currentFilePath: string | null
): { fullContentFiles: ProjectFileContext[]; summaryFiles: string[] } {
  if (projectFiles.length === 0) {
    return { fullContentFiles: [], summaryFiles: [] };
  }
  
  // If only a few files, send them all
  if (projectFiles.length <= MAX_FULL_CONTENT_FILES) {
    const totalSize = projectFiles.reduce((sum, f) => sum + f.content.length, 0);
    if (totalSize <= MAX_TOTAL_CONTENT_SIZE) {
      return { fullContentFiles: projectFiles, summaryFiles: [] };
    }
  }
  
  const fullContentFiles: ProjectFileContext[] = [];
  const summaryFiles: string[] = [];
  let totalSize = 0;
  
  // Priority 1: Current file (always include)
  const currentFile = projectFiles.find(f => f.path === currentFilePath);
  if (currentFile) {
    fullContentFiles.push(currentFile);
    totalSize += currentFile.content.length;
  }
  
  // Priority 2: Main entry files
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
  
  // Priority 3: Files referenced from current file
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
  
  // Priority 4: Bibliography files
  const bibFiles = projectFiles.filter(f => 
    f.path.endsWith('.bib') && !fullContentFiles.includes(f)
  );
  for (const bibFile of bibFiles) {
    if (totalSize >= MAX_TOTAL_CONTENT_SIZE) break;
    fullContentFiles.push(bibFile);
    totalSize += bibFile.content.length;
  }
  
  // Add remaining files to summary (just path info, no content)
  for (const file of projectFiles) {
    if (!fullContentFiles.includes(file)) {
      summaryFiles.push(file.path);
    }
  }
  
  return { fullContentFiles, summaryFiles };
}

/**
 * Build numbered content with line numbers for better editing precision
 * Non-blocking version using setImmediate for large documents
 * @param fileContent - The raw file content
 * @param textFromEditor - Optional selected text from editor
 * @returns Promise resolving to numbered content string
 */
export async function buildNumberedContent(fileContent: string, textFromEditor?: string | null): Promise<string> {
  return new Promise((resolve) => {
    // Use setImmediate to avoid blocking the event loop
    setImmediate(() => {
      const lines = fileContent.split('\n');
      // Reduced from 500 to 300 for smaller context
      const MAX_LINES_FULL_CONTEXT = 300;

      if (lines.length <= MAX_LINES_FULL_CONTEXT) {
        const numbered = lines
          .map((line, index) => `${index + 1}: ${line}`)
          .join('\n');
        resolve(numbered);
        return;
      }

      // Reduced from 100 to 75 lines per section for smaller context
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

/**
 * Normalize line endings by converting CRLF and CR to LF
 * @param text - Text to normalize
 * @returns Normalized text with LF line endings
 */
export function normalizeLineEndings(text: string): string {
  return text
    .split('\r\n').join('\n')
    .split('\r').join('\n');
}

/**
 * Validate API keys for required services
 * @returns Validation result with error message if invalid
 */
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
 * Build system prompt for the AI agent
 * @param numberedContent - Numbered file content
 * @param textFromEditor - Optional selected text
 * @param selectionRange - Optional selection range
 * @returns Complete system prompt
 */
export function buildSystemPrompt(
  numberedContent: string,
  textFromEditor?: string | null,
  selectionRange?: { startLineNumber: number; endLineNumber: number } | null,
  projectFiles?: ProjectFileContext[] | null,
  currentFilePath?: string | null
): string {
  const validProjectFiles =
    projectFiles?.filter(
      (file): file is ProjectFileContext =>
        !!file && typeof file.path === 'string' && typeof file.content === 'string'
    ) ?? [];

  // For multi-file projects, only list other files by name
  // The agent should use get_context to fetch content of any file it needs to edit
  const otherFiles = validProjectFiles
    .filter(f => f.path !== currentFilePath)
    .map(f => f.path);

  let projectSection = '';
  
  if (otherFiles.length > 0) {
    projectSection = `

Other project files available (use get_context tool to fetch content before editing):
${otherFiles.map(path => `- ${path}`).join('\n')}`;
  }

  const hasMultipleFiles = validProjectFiles.length > 1;
  const multiFileInstructions = hasMultipleFiles ? `

MULTI-FILE PROJECTS:
- The currently open file is: ${currentFilePath || 'unknown'}
- To edit OTHER files: First call get_context to see the file's content, then propose_edits with targetFile.
- For edits to other files, ALWAYS specify: { ..., targetFile: 'filename.tex' }
- Line numbers in targetFile edits refer to that file's line numbers.` : '';

  return `You are Octra, a LaTeX editing assistant. You edit LaTeX documents by calling the 'propose_edits' tool.

ABSOLUTE RULE: For ANY editing request, you MUST:
1. Immediately call the 'propose_edits' tool with the edit
2. NEVER explain what should be done manually
3. NEVER say you're "encountering issues" - just call the tool

You have THREE edit types:
- INSERT: { editType: 'insert', position: { line: N }, content: '...', originalLineCount: 0 }
- DELETE: { editType: 'delete', position: { line: N }, originalLineCount: M }
- REPLACE: { editType: 'replace', position: { line: N }, content: '...', originalLineCount: M }
${multiFileInstructions}

EXAMPLES:

User: "add a title"
You: [Call propose_edits with insert at line 2]

User: "remove the introduction"
You: [Call propose_edits with delete]

User: "fix the equation"
You: [Call propose_edits with replace]

WORKFLOW:
1. User asks for edit → You call propose_edits immediately
2. Tool returns success → You say "Done! Added/changed X"
3. That's it. No manual instructions, no explaining what to do.

Line numbers below are 1-indexed. Match them exactly in your edits.

---
${numberedContent}
---${textFromEditor ? `

Selected text:
---
${textFromEditor}
---` : ''}${selectionRange ? `

Selection: lines ${selectionRange.startLineNumber}-${selectionRange.endLineNumber}` : ''}${projectSection}`;
}
