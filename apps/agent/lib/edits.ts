/**
 * String-matching edit types and validation
 * Uses old_string/new_string pattern (opencode-style) instead of line-based edits
 */

import type { StringEdit } from '@octree/agent-protocol';

/**
 * Validate that old_string appears exactly once in the target file content
 */
export function validateStringEdit(
  edit: StringEdit,
  fileContent: string
): { valid: boolean; error?: string } {
  // For create/append (empty old_string), always valid
  if (edit.old_string === '') {
    return { valid: true };
  }

  const occurrences = countOccurrences(fileContent, edit.old_string);

  if (occurrences === 0) {
    return { valid: false, error: `old_string not found in file` };
  }
  if (occurrences > 1) {
    return { valid: false, error: `old_string matches ${occurrences} locations (must be unique)` };
  }

  return { valid: true };
}

/**
 * Infer the edit type from old_string/new_string
 */
export function inferEditType(edit: StringEdit): 'insert' | 'delete' | 'replace' {
  if (edit.old_string === '') return 'insert';
  if (edit.new_string === '') return 'delete';
  return 'replace';
}

function countOccurrences(text: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += 1;
  }
  return count;
}
