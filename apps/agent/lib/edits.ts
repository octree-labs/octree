/**
 * String-matching edit types and validation
 * Uses old_string/new_string pattern (opencode-style) instead of line-based edits
 */

import { IntentResult } from './intent-inference.js';

export interface StringEdit {
  file_path: string;
  old_string: string;
  new_string: string;
  explanation?: string;
}

export interface ValidationResult {
  isValid: boolean;
  violations: string[];
  acceptedEdits: StringEdit[];
}

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

/**
 * Validate edits against user intent
 */
export function validateStringEdits(
  edits: StringEdit[],
  intent: IntentResult,
  fileContents: Map<string, string>
): ValidationResult {
  const violations: string[] = [];
  const acceptedEdits: StringEdit[] = [];

  for (const edit of edits) {
    const editType = inferEditType(edit);

    // Enforce intent-based permissions
    if (editType === 'insert' && !intent.allowInsert) {
      violations.push(`Content insertion not allowed by inferred intent.`);
      continue;
    }
    if (editType === 'delete' && !intent.allowDelete) {
      violations.push(`Content deletion not allowed by inferred intent.`);
      continue;
    }
    if (editType === 'replace' && !intent.allowReplace) {
      violations.push(`Content replacement not allowed by inferred intent.`);
      continue;
    }

    // Validate uniqueness of old_string in target file
    const content = fileContents.get(edit.file_path);
    if (content !== undefined) {
      const validation = validateStringEdit(edit, content);
      if (!validation.valid) {
        violations.push(`Edit for ${edit.file_path}: ${validation.error}`);
        continue;
      }
    }

    acceptedEdits.push(edit);
  }

  return {
    isValid: violations.length === 0,
    violations,
    acceptedEdits,
  };
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
