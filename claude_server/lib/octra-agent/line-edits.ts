/**
 * Line-based edit classification and validation utilities
 * Provides structured edit type classification and validation logic
 */

import { IntentResult } from './intent-inference';

export type LineEditType = 'insert' | 'delete' | 'replace';

export interface LineEdit {
  editType: LineEditType;
  content?: string;
  position?: {
    line?: number;
  };
  originalLineCount?: number; // How many lines to affect (for delete/replace)
  explanation?: string;
  targetFile?: string; // Path of the file this edit targets (for multi-file projects)
}

export interface ValidationResult {
  isValid: boolean;
  violations: string[];
  acceptedEdits: LineEdit[];
}

/**
 * Validate line edits against user intent and constraints
 * @param edits - Array of proposed edits
 * @param intent - User intent permissions
 * @returns Validation result with accepted edits and violations
 */
export function validateLineEdits(
  edits: LineEdit[],
  intent: IntentResult,
  fileContent: string
): ValidationResult {
  const violations: string[] = [];
  const acceptedEdits: LineEdit[] = [];
  
  for (const edit of edits) {
    const lineNumber = edit.position?.line || 0;
    
    // Enforce intent-based permissions
    if (edit.editType === 'insert') {
      if (!intent.allowInsert) {
        violations.push(`Content insertion not allowed by inferred intent at line ${lineNumber}.`);
        continue;
      }
    }
    
    if (edit.editType === 'delete') {
      if (!intent.allowDelete) {
        violations.push(`Content deletion not allowed by inferred intent at line ${lineNumber}.`);
        continue;
      }
    }
    
    if (edit.editType === 'replace') {
      if (!intent.allowReplace) {
        violations.push(`Content replacement not allowed by inferred intent at line ${lineNumber}.`);
        continue;
      }
    }
    
    acceptedEdits.push(edit);
  }
  
  return {
    isValid: violations.length === 0,
    violations,
    acceptedEdits
  };
}

