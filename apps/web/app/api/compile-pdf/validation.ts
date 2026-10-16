import type { CompileRequest } from './types';

export interface ValidationError {
  error: string;
  details: string;
  suggestion: string;
}

/**
 * Validates the compile request
 */
export function validateCompileRequest(body: Partial<CompileRequest>): ValidationError | null {
  const { files, content } = body;

  if (files && Array.isArray(files) && files.length > 0) {
    return null;
  }

  if (typeof content === 'string' && content.trim().length > 0) {
    return null;
  }

  return {
    error: 'Invalid request',
    details: 'Must provide a files array with at least one entry or legacy content string',
    suggestion: 'Please provide your LaTeX project files',
  };
}

/**
 * Validates LaTeX structure
 */
export function validateLatexStructure(body: CompileRequest): ValidationError | null {
  const { files } = body;

  // Extract main content
  let mainContent = '';
  if (files && files.length > 0) {
    // Find main.tex in multi-file project
    const mainFile = files.find(f => f.path === 'main.tex') || files.find(f => f.path.endsWith('.tex'));
    mainContent = mainFile?.content || '';
  }

  if (!mainContent) {
    return null;
  }

  const hasDocumentClass = mainContent.includes('\\documentclass');
  const hasBeginDocument = mainContent.includes('\\begin{document}');
  const hasEndDocument = mainContent.includes('\\end{document}');

  if (!hasDocumentClass) {
    return {
      error: 'Invalid LaTeX structure',
      details: 'LaTeX document must start with \\documentclass declaration',
      suggestion: 'Add \\documentclass{article} at the beginning of your document',
    };
  }

  if (!hasBeginDocument || !hasEndDocument) {
    return {
      error: 'Invalid LaTeX structure',
      details: 'LaTeX document must have \\begin{document} and \\end{document}',
      suggestion: 'Wrap your content between \\begin{document} and \\end{document}',
    };
  }

  return null;
}

