import { EditSuggestion } from '@/types/edit';
import type * as Monaco from 'monaco-editor';
import { toast } from 'sonner';
import { FileActions } from '@/stores/file';
import { findOldStringRange, isSuggestionStillValid } from './utils';

export interface AcceptEditOptions {
  currentFilePath?: string | null;
  onSwitchFile?: (filePath: string) => void;
  onOtherFileEdited?: (filePath: string, newContent: string) => void;
}

/**
 * Apply a string edit directly to file content (without requiring Monaco editor)
 */
export function applyEditToContent(content: string, suggestion: EditSuggestion): string {
  if (suggestion.old_string === '') {
    // Append to end of file
    return content + suggestion.new_string;
  }

  const idx = content.indexOf(suggestion.old_string);
  if (idx === -1) {
    throw new Error('old_string not found in content');
  }

  return content.slice(0, idx) + suggestion.new_string + content.slice(idx + suggestion.old_string.length);
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
  const targetFile = suggestion.file_path;
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
    if (suggestion.old_string === '') {
      // Append to end of file
      const lastLine = model.getLineCount();
      const lastCol = model.getLineMaxColumn(lastLine);
      const range = new monacoInstance.Range(lastLine, lastCol, lastLine, lastCol);

      editor.executeEdits('accept-ai-suggestion', [
        {
          range,
          text: suggestion.new_string,
          forceMoveMarkers: true,
        },
      ]);
    } else {
      // Find the old_string in the model
      const range = findOldStringRange(model, suggestion.old_string);
      if (!range) {
        toast.error('Could not locate the text to replace. It may have been modified.');
        return;
      }

      editor.executeEdits('accept-ai-suggestion', [
        {
          range,
          text: suggestion.new_string,
          forceMoveMarkers: true,
        },
      ]);
    }

    // Mark as accepted and filter out invalidated pending suggestions
    onUpdate((prev) => {
      const updatedModel = editor.getModel();

      return prev
        .map((s) => s.id === suggestionId ? { ...s, status: 'accepted' as const } : s)
        .filter((s) => {
          // Keep accepted/rejected suggestions
          if (s.status !== 'pending') return true;
          // Keep suggestions for other files
          if (s.file_path && currentFile && s.file_path !== currentFile) return true;
          // Check if this pending suggestion is still valid
          if (!updatedModel) return true;
          return isSuggestionStillValid(updatedModel, s);
        });
    });

    toast.success('Edit applied', { duration: 1000 });
  } catch (error) {
    console.error('Error applying edit:', error);
    toast.error('Failed to apply this suggestion. Please try again.');
  }
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
    if (!s.file_path || !currentFile) return true;
    return s.file_path === currentFile;
  });

  const otherFileEdits = allPendingSuggestions.filter((s) => {
    if (!s.file_path || !currentFile) return false;
    return s.file_path !== currentFile;
  });

  // Group other-file edits by target file to apply in batches
  const editsByFile = new Map<string, EditSuggestion[]>();
  for (const edit of otherFileEdits) {
    const targetFile = edit.file_path;
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
      // Apply edits bottom-to-top by finding positions
      let result = content;
      // Sort by position in file (reverse order) to not shift later edits
      const sortedEdits = [...edits].sort((a, b) => {
        const posA = result.indexOf(a.old_string);
        const posB = result.indexOf(b.old_string);
        return posB - posA;
      });

      for (const edit of sortedEdits) {
        result = applyEditToContent(result, edit);
      }

      FileActions.setContentByPath(targetFile, result);

      if (options?.onOtherFileEdited) {
        options.onOtherFileEdited(targetFile, result);
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
    // Find all old_string ranges, then sort bottom-to-top and batch executeEdits
    const editsWithRanges: { suggestion: EditSuggestion; range: Monaco.Range }[] = [];

    for (const suggestion of currentFileEdits) {
      if (suggestion.old_string === '') {
        // Append: use end of file
        const lastLine = model.getLineCount();
        const lastCol = model.getLineMaxColumn(lastLine);
        editsWithRanges.push({
          suggestion,
          range: new monacoInstance.Range(lastLine, lastCol, lastLine, lastCol),
        });
      } else {
        const range = findOldStringRange(model, suggestion.old_string);
        if (range) {
          editsWithRanges.push({ suggestion, range });
        } else {
          console.warn(`Could not find old_string for suggestion ${suggestion.id}`);
        }
      }
    }

    // Sort bottom-to-top to avoid position shifts
    editsWithRanges.sort((a, b) => b.range.startLineNumber - a.range.startLineNumber || b.range.startColumn - a.range.startColumn);

    const monacoEdits = editsWithRanges.map(({ suggestion, range }) => ({
      range,
      text: suggestion.new_string,
      forceMoveMarkers: true,
    }));

    editor.executeEdits('accept-all-ai-suggestions', monacoEdits);

    // Clear all suggestions
    onClearAll();

    const totalApplied = editsWithRanges.length + appliedOtherFileIds.length;
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
  const targetFile = suggestion.file_path || currentFilePath;
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
    const newContent = applyEditToContent(content, suggestion);

    FileActions.setContentByPath(targetFile, newContent);

    if (onOtherFileEdited) {
      onOtherFileEdited(targetFile, newContent);
    }

    // Mark as accepted and filter out invalidated pending suggestions
    onUpdate((prev) => {
      return prev
        .map((s) => s.id === suggestionId ? { ...s, status: 'accepted' as const } : s)
        .filter((s) => {
          // Keep accepted/rejected suggestions
          if (s.status !== 'pending') return true;
          // Keep suggestions for other files
          if (s.file_path && s.file_path !== targetFile) return true;
          // For same-file suggestions, check if old_string is still findable
          if (s.old_string === '') return true; // Append is always valid
          return newContent.indexOf(s.old_string) !== -1;
        });
    });

    toast.success('Edit applied', { duration: 1000 });
    return true;
  } catch (error) {
    console.error('Error applying edit:', error);
    toast.error('Failed to apply this suggestion.');
    return false;
  }
}
