'use client';

import { useEffect } from 'react';
import type * as Monaco from 'monaco-editor';
import { useSidebar } from '@/components/ui/sidebar';

export interface KeyboardShortcutsConfig {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  monacoInstance: typeof Monaco | null;
  onSave?: (content: string) => void;
  onCopy?: (text: string) => void;
  onTextFormat?: (format: 'bold' | 'italic' | 'underline') => void;
}

export function useEditorKeyboardShortcuts({
  editor,
  monacoInstance,
  onSave,
  onCopy,
  onTextFormat,
}: KeyboardShortcutsConfig) {
  const { toggleSidebar } = useSidebar();

  useEffect(() => {
    if (!editor || !monacoInstance) return;

    // Add our own key event listener to the editor's DOM node
    // This will run before Monaco's handlers and allows us to prevent default behavior
    const editorDomNode = editor.getDomNode();
    if (editorDomNode) {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Check for Cmd+S or Ctrl+S
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault(); // This prevents browser's save dialog
          e.stopPropagation(); // Stop the event from propagating

          // Get the current content directly from the editor
          const currentContent = editor.getValue();

          // Execute save callback if provided
          if (onSave) {
            onSave(currentContent);
          }

          return false;
        }

        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          e.stopPropagation();
          toggleSidebar();
          return false;
        }
      };

      editorDomNode.addEventListener('keydown', handleKeyDown);

      // Cleanup function
      return () => {
        editorDomNode.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [editor, monacoInstance, onSave, toggleSidebar]);

  useEffect(() => {
    if (!editor || !monacoInstance) return;

    // Add Cmd+B command for text selection
    const cmdBCommand = editor.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyB,
      () => {
        if (!editor) {
          console.error(
            '[useEditorKeyboardShortcuts] Cmd+B Error: editor is not available.'
          );
          return;
        }

        const selection = editor.getSelection();
        if (!selection || selection.isEmpty()) {
          return;
        }

        const model = editor.getModel();
        if (!model) {
          return;
        }

        const directlySelectedText = model.getValueInRange(selection);

        if (directlySelectedText && directlySelectedText.trim() && onCopy) {
          onCopy(directlySelectedText);
        }
      },
      'editorTextFocus'
    );

    // Add suggestion actions (Accept/Reject in context menu)
    const acceptSuggestionAction = editor.addAction({
      id: 'accept-suggestion',
      label: 'Accept Suggestion',
      contextMenuGroupId: 'suggestion',
      run: (ed) => {
        const position = ed.getPosition();
        if (!position) return;

        const decorations = ed.getLineDecorations(position.lineNumber);
        const suggestion = decorations?.find(
          (d) => d.options.after && 'attachedData' in d.options.after
        );
        if (
          suggestion?.options.after &&
          'attachedData' in suggestion.options.after
        ) {
          // This would need to be connected to the suggestions hook
          console.log(
            'Accept suggestion:',
            suggestion.options.after.attachedData
          );
        }
      },
    });

    // Cleanup disposables - only dispose if they are disposable objects
    return () => {
      if (
        acceptSuggestionAction &&
        typeof acceptSuggestionAction.dispose === 'function'
      ) {
        acceptSuggestionAction.dispose();
      }
      // Commands return strings, not disposables, so no cleanup needed for cmdBCommand
    };
  }, [editor, monacoInstance, onCopy]);

  // Text formatting shortcuts (optional) - Note: These are disabled to avoid conflicts with text selection
  // Text formatting is handled through the toolbar instead
  useEffect(() => {
    if (!editor || !monacoInstance || !onTextFormat) return;

    // Text formatting shortcuts are handled via toolbar to avoid conflicts
    // with existing Cmd+B shortcut for text selection

    return () => {
      // No cleanup needed for formatting shortcuts
    };
  }, [editor, monacoInstance, onTextFormat]);
}
