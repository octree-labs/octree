import { EditSuggestion } from '@/types/edit';
import { v4 as uuidv4 } from 'uuid';

const DIFF_BLOCK_REGEX = /```latex-diff[^\n]*\r?\n([\s\S]*?)\r?\n```/gi;
const DIFF_HEADER_REGEX =
  /@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/;

export function parseLatexDiff(content: string, filePath = ''): EditSuggestion[] {
  const suggestions: EditSuggestion[] = [];
  let match: RegExpExecArray | null;

  while ((match = DIFF_BLOCK_REGEX.exec(content)) !== null) {
    const diffBlockContent = match[1];
    const lines = diffBlockContent.trim().split(/\r?\n/);

    const headerMatch = lines[0]?.match(DIFF_HEADER_REGEX);

    if (!headerMatch) {
      console.error('Could not parse diff header:', lines[0]);
      continue;
    }

    let originalContent = '';
    let suggestedContent = '';

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const lineContent = line.slice(1);

      if (line.startsWith('-')) {
        originalContent += lineContent + '\n';
      } else if (line.startsWith('+')) {
        suggestedContent += lineContent + '\n';
      }
    }

    originalContent = originalContent.replace(/\n$/, '');
    suggestedContent = suggestedContent.replace(/\n$/, '');

    if (originalContent || suggestedContent) {
      suggestions.push({
        id: uuidv4(),
        file_path: filePath,
        old_string: originalContent,
        new_string: suggestedContent,
        status: 'pending',
      });
    }
  }

  return suggestions;
}
