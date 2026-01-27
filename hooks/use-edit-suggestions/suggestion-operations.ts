import { EditSuggestion } from '@/types/edit';
import type * as Monaco from 'monaco-editor';
import { toast } from 'sonner';
import { FileActions } from '@/stores/file';
import {
  getStartLine,
  getOriginalLineCount,
  getSuggestedText,
  computeDeltaLines,
  rangesOverlap,
} from './utils';

export interface AcceptEditOptions {
  currentFilePath?: string | null;
  onSwitchFile?: (filePath: string) => void;
  onOtherFileEdited?: (filePath: string, newContent: string) => void;
}

/**
 * Apply an edit directly to file content (without requiring Monaco editor)
 */
function applyEditToContent(content: string, suggestion: EditSuggestion): string {
  const lines = content.split('\n');
  const startLine = getStartLine(suggestion);
  const originalLineCount = getOriginalLineCount(suggestion);
  const suggestedText = getSuggestedText(suggestion);
  
  // Convert to 0-based index
  const startIndex = startLine - 1;
  const endIndex = originalLineCount > 0 ? startIndex + originalLineCount : startIndex;
  
  // Split suggested text into lines
  const newLines = suggestedText.split('\n');
  
  // Replace the lines
  if (originalLineCount === 0) {
    // Insert: add new lines at the position
    lines.splice(startIndex, 0, ...newLines);
  } else {
    // Replace or delete
    lines.splice(startIndex, originalLineCount, ...newLines);
  }
  
  return lines.join('\n');
}

/**
 * Accept a single edit suggestion and apply it to the editor
 */
export async function acceptSingleEdit(
  suggestionId: string,
  editSuggestions: EditSuggestion[],
  editor: Monaco.editor.IStandaloneCodeEditor,
  monacoInstance: typeof Monaco,
  onUpdate: (updater: (prev: EditSuggestion[]) => EditSuggestion[]) => void,
  options?: AcceptEditOptions
): Promise<void> {
  const suggestion = editSuggestions.find((s) => s.id === suggestionId);
  if (!suggestion || suggestion.status !== 'pending') return;

  // Check if target file matches current file
  const targetFile = suggestion.targetFile;
  const currentFile = options?.currentFilePath;
  
  // If target file doesn't match current file, apply directly to file store
  if (targetFile && currentFile && targetFile !== currentFile) {
    acceptEditDirect(suggestionId, editSuggestions, onUpdate, currentFile, options?.onOtherFileEdited);
    return;
  }

  const model = editor.getModel();
  if (!model) {
    console.error('Editor model not available.');
    return;
  }

  try {
    const startLineNumber = getStartLine(suggestion);
    const originalLineCount = getOriginalLineCount(suggestion);
    const suggestedText = getSuggestedText(suggestion);
    
    const endLineNumber =
      originalLineCount > 0
        ? startLineNumber + originalLineCount - 1
        : startLineNumber;
    const endColumn =
      originalLineCount > 0
        ? model.getLineMaxColumn(endLineNumber)
        : 1;

    const rangeToReplace = new monacoInstance.Range(
      startLineNumber,
      1,
      endLineNumber,
      endColumn
    );

    // Apply suggestion immediately
    editor.executeEdits('accept-ai-suggestion', [
      {
        range: rangeToReplace,
        text: suggestedText,
        forceMoveMarkers: true,
      },
    ]);

    // Rebase remaining suggestions to account for line shifts
    const deltaLines = computeDeltaLines(suggestedText, originalLineCount);
    const acceptedStart = startLineNumber;
    const acceptedEnd = endLineNumber;

    onUpdate((prev) => {
      const remaining = prev.filter((s) => s.id !== suggestionId);
      const adjusted: EditSuggestion[] = [];
      
      for (const s of remaining) {
        const sStart = getStartLine(s);
        const sOriginalLineCount = getOriginalLineCount(s);
        const sEnd = sOriginalLineCount > 0 ? sStart + sOriginalLineCount - 1 : sStart;

        // If suggestion overlaps the accepted region, handle conflict
        if (rangesOverlap(sStart, sEnd, acceptedStart, acceptedEnd)) {
          // Tie-aware insert: if both are pure insertions on the same line, shift instead of drop
          const acceptedIsInsert = originalLineCount === 0;
          const currentIsInsert = sOriginalLineCount === 0;
          if (
            acceptedIsInsert &&
            currentIsInsert &&
            sStart === acceptedStart &&
            deltaLines !== 0
          ) {
            adjusted.push({ 
              ...s, 
              position: { 
                ...s.position, 
                line: (s.position?.line || 1) + deltaLines 
              } 
            });
          }
          // Otherwise skip conflicting suggestion
          continue;
        }

        // If suggestion is after the accepted region, shift by deltaLines
        if (sStart > acceptedEnd && deltaLines !== 0) {
          adjusted.push({
            ...s,
            position: { 
              ...s.position, 
              line: (s.position?.line || 1) + deltaLines 
            },
          });
        } else {
          adjusted.push(s);
        }
      }
      return adjusted;
    });
    
    toast.success('Edit applied', { duration: 1000 });
  } catch (error) {
    console.error('Error applying edit:', error);
    toast.error('Failed to apply this suggestion. Please try again.');
  }
}

/**
 * Apply multiple edits to a file's content in one batch (sorted bottom-to-top)
 */
function applyEditsToContentBatch(content: string, suggestions: EditSuggestion[]): string {
  // Sort from bottom to top to avoid position shifts affecting later edits
  const sorted = [...suggestions].sort((a, b) => getStartLine(b) - getStartLine(a));
  
  let result = content;
  for (const suggestion of sorted) {
    result = applyEditToContent(result, suggestion);
  }
  return result;
}

/**
 * Accept all pending edit suggestions at once
 */
export async function acceptAllEdits(
  allPendingSuggestions: EditSuggestion[],
  editor: Monaco.editor.IStandaloneCodeEditor,
  monacoInstance: typeof Monaco,
  onClearAll: () => void,
  onPartialClear?: (appliedIds: string[]) => void,
  options?: AcceptEditOptions
): Promise<void> {
  if (allPendingSuggestions.length === 0) return;

  const model = editor.getModel();
  if (!model) {
    console.error('Editor model not available.');
    return;
  }

  // Separate edits: current file (use Monaco) vs other files (use direct)
  const currentFile = options?.currentFilePath;
  const currentFileEdits = allPendingSuggestions.filter((s) => {
    if (!s.targetFile || !currentFile) return true;
    return s.targetFile === currentFile;
  });
  
  const otherFileEdits = allPendingSuggestions.filter((s) => {
    if (!s.targetFile || !currentFile) return false;
    return s.targetFile !== currentFile;
  });

  // Group other-file edits by target file to apply in batches (fixes race condition)
  const editsByFile = new Map<string, EditSuggestion[]>();
  for (const edit of otherFileEdits) {
    const targetFile = edit.targetFile!;
    if (!editsByFile.has(targetFile)) {
      editsByFile.set(targetFile, []);
    }
    editsByFile.get(targetFile)!.push(edit);
  }

  // Apply edits to each other file in one batch per file
  const appliedOtherFileIds: string[] = [];
  for (const [targetFile, edits] of editsByFile) {
    const content = FileActions.getContentByPath(targetFile);
    if (content === null) {
      console.error(`File "${targetFile}" not found or has no content.`);
      continue;
    }
    
    try {
      const newContent = applyEditsToContentBatch(content, edits);
      FileActions.setContentByPath(targetFile, newContent);
      
      // Notify parent that another file was edited (for Monaco sync)
      if (options?.onOtherFileEdited) {
        options.onOtherFileEdited(targetFile, newContent);
      }
      
      appliedOtherFileIds.push(...edits.map(e => e.id));
    } catch (error) {
      console.error(`Error applying edits to ${targetFile}:`, error);
    }
  }

  // If no current file edits, clear applied suggestions and return
  if (currentFileEdits.length === 0) {
    if (appliedOtherFileIds.length > 0) {
      if (onPartialClear) {
        onPartialClear(appliedOtherFileIds);
      } else {
        onClearAll();
      }
      toast.success(`Applied ${appliedOtherFileIds.length} edit(s)`, { duration: 2000 });
    }
    return;
  }

  try {
    // Sort suggestions from bottom to top (highest line first)
    // This prevents earlier edits from affecting the positions of later edits
    const sortedSuggestions = [...currentFileEdits].sort((a, b) => {
      const lineA = getStartLine(a);
      const lineB = getStartLine(b);
      return lineB - lineA; // Descending order
    });

    // Build all edit operations
    const edits = sortedSuggestions.map((suggestion) => {
      const startLineNumber = getStartLine(suggestion);
      const originalLineCount = getOriginalLineCount(suggestion);
      const suggestedText = getSuggestedText(suggestion);
      
      const endLineNumber =
        originalLineCount > 0
          ? startLineNumber + originalLineCount - 1
          : startLineNumber;
      const endColumn =
        originalLineCount > 0
          ? model.getLineMaxColumn(endLineNumber)
          : 1;

      return {
        range: new monacoInstance.Range(
          startLineNumber,
          1,
          endLineNumber,
          endColumn
        ),
        text: suggestedText,
        forceMoveMarkers: true,
      };
    });

    // Apply all edits in a single batch operation
    editor.executeEdits('accept-all-ai-suggestions', edits);

    // Clear all suggestions (including those applied to other files)
    onClearAll();
    
    const totalApplied = currentFileEdits.length + appliedOtherFileIds.length;
    toast.success(`Applied ${totalApplied} edit(s)`, { duration: 2000 });
  } catch (error) {
    console.error('Error applying all edits:', error);
    toast.error('Failed to apply suggestions. Please try again.');
  }
}

/**
 * Reject a single edit suggestion
 */
export function rejectEdit(
  suggestionId: string,
  onUpdate: (updater: (prev: EditSuggestion[]) => EditSuggestion[]) => void
): void {
  onUpdate((prev) => prev.filter((s) => s.id !== suggestionId));
}

/**
 * Accept a single edit by directly modifying the file store (no Monaco required)
 */
export function acceptEditDirect(
  suggestionId: string,
  editSuggestions: EditSuggestion[],
  onUpdate: (updater: (prev: EditSuggestion[]) => EditSuggestion[]) => void,
  currentFilePath?: string | null,
  onOtherFileEdited?: (filePath: string, newContent: string) => void
): boolean {
  const suggestion = editSuggestions.find((s) => s.id === suggestionId);
  if (!suggestion || suggestion.status !== 'pending') return false;

  // Determine target file
  const targetFile = suggestion.targetFile || currentFilePath;
  if (!targetFile) {
    toast.error('Cannot determine which file to edit.');
    return false;
  }

  // Get current content from file store
  const content = FileActions.getContentByPath(targetFile);
  if (content === null) {
    toast.error(`File "${targetFile}" not found or has no content.`);
    return false;
  }

  try {
    // Apply the edit to the content
    const newContent = applyEditToContent(content, suggestion);
    
    // Update the file store
    FileActions.setContentByPath(targetFile, newContent);
    
    // Notify parent that another file was edited (for Monaco sync)
    if (onOtherFileEdited) {
      onOtherFileEdited(targetFile, newContent);
    }

    // Rebase remaining suggestions
    const startLine = getStartLine(suggestion);
    const originalLineCount = getOriginalLineCount(suggestion);
    const suggestedText = getSuggestedText(suggestion);
    const deltaLines = computeDeltaLines(suggestedText, originalLineCount);
    const acceptedEnd = originalLineCount > 0 ? startLine + originalLineCount - 1 : startLine;

    onUpdate((prev) => {
      const remaining = prev.filter((s) => s.id !== suggestionId);
      const adjusted: EditSuggestion[] = [];
      
      for (const s of remaining) {
        // Only rebase suggestions for the same file
        if (s.targetFile !== targetFile && s.targetFile) {
          adjusted.push(s);
          continue;
        }

        const sStart = getStartLine(s);
        const sOriginalLineCount = getOriginalLineCount(s);
        const sEnd = sOriginalLineCount > 0 ? sStart + sOriginalLineCount - 1 : sStart;

        // Skip if overlaps
        if (rangesOverlap(sStart, sEnd, startLine, acceptedEnd)) {
          continue;
        }

        // Shift if after the accepted region
        if (sStart > acceptedEnd && deltaLines !== 0) {
          adjusted.push({
            ...s,
            position: { 
              ...s.position, 
              line: (s.position?.line || 1) + deltaLines 
            },
          });
        } else {
          adjusted.push(s);
        }
      }
      return adjusted;
    });
    
    toast.success('Edit applied', { duration: 1000 });
    return true;
  } catch (error) {
    console.error('Error applying edit:', error);
    toast.error('Failed to apply this suggestion.');
    return false;
  }
}

