'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import type * as Monaco from 'monaco-editor';

const CITATION_INLINE_CLASS = 'octra-citation-ref';
const CITATION_HOVER_CLASS = 'octra-citation-ref-hover';
const CITATION_PATTERN = /\[(\d+)\]/g;
const CITE_COMMAND_PATTERN = /\\cite[a-zA-Z*]*\s*(?:\[[^\]]*\]\s*)*\{([^}]+)\}/g;

type CitationTarget =
  | { kind: 'number'; value: number }
  | { kind: 'key'; value: string };

export interface EditorInteractionsState {
  showButton: boolean;
  buttonPos: { top: number; left: number };
  selectedText: string;
  textFromEditor: string | null;
  selectionRange: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
  chatOpen: boolean;
  setChatOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTextFromEditor: (text: string | null) => void;
  handleCopy: (textToCopy?: string) => void;
  setupEditorListeners: (editor: Monaco.editor.IStandaloneCodeEditor) => void;
}

function getCitationDecorations(editor: Monaco.editor.IStandaloneCodeEditor) {
  const model = editor.getModel();
  if (!model) {
    return {
      decorations: [] as Monaco.editor.IModelDeltaDecoration[],
      targets: [] as CitationTarget[],
    };
  }

  const decorations: Monaco.editor.IModelDeltaDecoration[] = [];
  const targets: CitationTarget[] = [];

  for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
    const line = model.getLineContent(lineNumber);

    CITE_COMMAND_PATTERN.lastIndex = 0;
    let citeMatch = CITE_COMMAND_PATTERN.exec(line);

    while (citeMatch) {
      const fullMatch = citeMatch[0];
      const keys = citeMatch[1] ?? '';
      const keysStartInMatch = fullMatch.lastIndexOf('{') + 1;

      let cursor = 0;
      for (const rawKey of keys.split(',')) {
        const key = rawKey.trim();
        if (!key) continue;

        const keyIndexInKeys = keys.indexOf(key, cursor);
        if (keyIndexInKeys < 0) continue;
        cursor = keyIndexInKeys + key.length;

        const startColumn =
          citeMatch.index + keysStartInMatch + keyIndexInKeys + 1;
        const endColumn = startColumn + key.length;

        decorations.push({
          range: {
            startLineNumber: lineNumber,
            startColumn,
            endLineNumber: lineNumber,
            endColumn,
          },
          options: {
            inlineClassName: CITATION_INLINE_CLASS,
            hoverMessage: { value: `Click to jump to bibliography key: ${key}` },
          },
        });
        targets.push({ kind: 'key', value: key });
      }

      citeMatch = CITE_COMMAND_PATTERN.exec(line);
    }

    CITATION_PATTERN.lastIndex = 0;
    let match = CITATION_PATTERN.exec(line);

    while (match) {
      const startColumn = match.index + 1;
      const endColumn = startColumn + match[0].length;

      decorations.push({
        range: {
          startLineNumber: lineNumber,
          startColumn,
          endLineNumber: lineNumber,
          endColumn,
        },
        options: {
          inlineClassName: CITATION_INLINE_CLASS,
          hoverMessage: { value: 'Click to jump to bibliography entry' },
        },
      });
      targets.push({ kind: 'number', value: Number(match[1]) });

      match = CITATION_PATTERN.exec(line);
    }
  }

  return { decorations, targets };
}

function getBibitemLineByNumber(
  model: Monaco.editor.ITextModel,
  citationNumber: number
) {
  const bibitemLines: number[] = [];
  const numberedReferenceLines: Record<number, number> = {};
  const bibEntryLines: number[] = [];

  for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
    const line = model.getLineContent(lineNumber);

    if (/\\bibitem(?:\[[^\]]*\])?\{[^}]+\}/.test(line)) {
      bibitemLines.push(lineNumber);
    }

    const numberedReferenceMatch = line.match(/^\s*\[(\d+)\]\s+/);
    if (numberedReferenceMatch) {
      const number = Number(numberedReferenceMatch[1]);
      if (!Number.isNaN(number) && numberedReferenceLines[number] === undefined) {
        numberedReferenceLines[number] = lineNumber;
      }
    }

    if (/^\s*@\w+\s*\{/.test(line)) {
      bibEntryLines.push(lineNumber);
    }
  }

  if (numberedReferenceLines[citationNumber] !== undefined) {
    return numberedReferenceLines[citationNumber];
  }

  if (citationNumber >= 1 && citationNumber <= bibitemLines.length) {
    return bibitemLines[citationNumber - 1];
  }

  if (citationNumber >= 1 && citationNumber <= bibEntryLines.length) {
    return bibEntryLines[citationNumber - 1];
  }

  return null;
}

function getBibitemLineByKey(
  model: Monaco.editor.ITextModel,
  citationKey: string
) {
  for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
    const line = model.getLineContent(lineNumber);
    const escapedKey = citationKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (new RegExp(`\\\\bibitem(?:\\[[^\\]]*\\])?\\{\\s*${escapedKey}\\s*\\}`).test(line)) {
      return lineNumber;
    }

    if (new RegExp(`^\\s*@\\w+\\s*\\{\\s*${escapedKey}\\s*,`).test(line)) {
      return lineNumber;
    }
  }

  return null;
}

export function useEditorInteractions(): EditorInteractionsState {
  const [showButton, setShowButton] = useState(false);
  const [buttonPos, setButtonPos] = useState({ top: 0, left: 0 });
  const [selectedText, setSelectedText] = useState('');
  const [textFromEditor, setTextFromEditor] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<{
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const citationDecorationIdsRef = useRef<string[]>([]);
  const citationDecorationIdSetRef = useRef<Set<string>>(new Set());
  const citationTargetsByDecorationIdRef = useRef<Map<string, CitationTarget>>(
    new Map()
  );

  const handleCopy = useCallback(
    (textToCopy?: string) => {
      const currentSelectedText = textToCopy ?? selectedText;

      if (currentSelectedText.trim()) {
        setTextFromEditor(currentSelectedText);
        setShowButton(false);
        setChatOpen(true);
      }
    },
    [selectedText]
  );

  const debouncedCursorSelection = useDebouncedCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor) => {
      const selection = editor.getSelection();
      const model = editor.getModel();
      const text = model?.getValueInRange(selection!);

      if (text && selection && !selection?.isEmpty()) {
        const range = {
          startLineNumber: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLineNumber: selection.endLineNumber,
          endColumn: selection.endColumn,
        };
        const startCoords = editor.getScrolledVisiblePosition({
          lineNumber: range.startLineNumber,
          column: range.startColumn,
        });

        if (startCoords) {
          const editorContainer = editor.getContainerDomNode();
          const containerRect = editorContainer.getBoundingClientRect();

          setButtonPos({
            top: containerRect.top + startCoords.top - 30,
            left: containerRect.left + startCoords.left,
          });
          setSelectedText(text);
          setSelectionRange(range);
          setShowButton(true);
        }
      } else {
        setShowButton(false);
        setSelectedText('');
        setSelectionRange(null);
      }
    },
    200
  );

  const setupEditorListeners = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor) => {
      // Add selection change listener for floating button
      editor.onDidChangeCursorSelection(() => {
        debouncedCursorSelection(editor);
      });

      const applyCitationDecorations = () => {
        const { decorations: nextDecorations, targets } = getCitationDecorations(editor);
        const nextDecorationIds = editor.deltaDecorations(
          citationDecorationIdsRef.current,
          nextDecorations
        );
        citationDecorationIdsRef.current = nextDecorationIds;
        citationDecorationIdSetRef.current = new Set(nextDecorationIds);
        const targetMap = new Map<string, CitationTarget>();
        nextDecorationIds.forEach((id, index) => {
          const target = targets[index];
          if (target) {
            targetMap.set(id, target);
          }
        });
        citationTargetsByDecorationIdRef.current = targetMap;
      };

      applyCitationDecorations();
      editor.onDidChangeModelContent(() => {
        applyCitationDecorations();
      });

      editor.onMouseMove((event) => {
        const model = editor.getModel();
        const position = event.target.position;
        if (!model || !position) {
          editor.getDomNode()?.classList.remove(CITATION_HOVER_CLASS);
          return;
        }

        const decorations = model.getDecorationsInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column + 1,
        });

        const isOverCitation = decorations.some((decoration) =>
          citationDecorationIdSetRef.current.has(decoration.id)
        );
        editor.getDomNode()?.classList.toggle(CITATION_HOVER_CLASS, isOverCitation);
      });

      editor.onMouseLeave(() => {
        editor.getDomNode()?.classList.remove(CITATION_HOVER_CLASS);
      });

      editor.onMouseDown((event) => {
        const model = editor.getModel();
        const position = event.target.position;
        if (!model || !position) return;

        const decorations = model.getDecorationsInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column + 1,
        });

        const citationDecoration = decorations.find((decoration) =>
          citationDecorationIdSetRef.current.has(decoration.id)
        );
        if (!citationDecoration) return;
        const target = citationTargetsByDecorationIdRef.current.get(
          citationDecoration.id
        );
        if (!target) return;

        const bibLine =
          target.kind === 'number'
            ? getBibitemLineByNumber(model, target.value)
            : getBibitemLineByKey(model, target.value);
        if (!bibLine) return;

        editor.setPosition({ lineNumber: bibLine, column: 1 });
        editor.revealLineInCenter(bibLine);
        editor.focus();
      });
    },
    [debouncedCursorSelection]
  );

  return {
    showButton,
    buttonPos,
    selectedText,
    textFromEditor,
    selectionRange,
    chatOpen,
    setChatOpen,
    setTextFromEditor,
    handleCopy,
    setupEditorListeners,
  };
}
