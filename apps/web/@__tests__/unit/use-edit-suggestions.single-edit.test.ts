import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type * as Monaco from 'monaco-editor';
import { useEditSuggestions } from '@/hooks/use-edit-suggestions';
import { EditSuggestion } from '@/types/edit';

// --- Test helpers ---
class FakeModel {
  private lines: string[];
  constructor(text: string) { this.lines = text.split('\n'); }
  getLineCount() { return this.lines.length; }
  getLineMaxColumn(line: number) { return (this.lines[line - 1]?.length ?? 0) + 1; }
  getLineContent(line: number) { return this.lines[line - 1] ?? ''; }
}

class FakeRange implements Monaco.IRange {
  startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number;
  constructor(sln: number, sc: number, eln: number, ec: number) {
    this.startLineNumber = sln; this.startColumn = sc; this.endLineNumber = eln; this.endColumn = ec;
  }
}

function createFakeEditor(initial: string) {
  const model = new FakeModel(initial) as unknown as Monaco.editor.ITextModel;
  const executeEdits = vi.fn();
  const deltaDecorations = vi.fn().mockReturnValue([]);
  const getModel = vi.fn(() => model);
  const editor = { executeEdits, deltaDecorations, getModel } as unknown as Monaco.editor.IStandaloneCodeEditor;
  const monacoInstance = {
    Range: FakeRange as unknown as typeof Monaco.Range,
    editor: { TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 0 } },
  } as unknown as typeof Monaco;
  return { editor, monacoInstance, executeEdits };
}

function makeSuggestion(id: string, editType: 'insert'|'replace'|'delete', line: number, text: string, originalLineCount?: number): EditSuggestion {
  return {
    id,
    status: 'pending',
    editType,
    position: { line },
    content: text,
    originalLineCount,
  } as EditSuggestion;
}

describe('useEditSuggestions - single edit acceptance', () => {
  it('accepts a single insert at a line (column 1 range)', async () => {
    const { editor, monacoInstance, executeEdits } = createFakeEditor('a\nb\nc');
    const { result } = renderHook(() => useEditSuggestions({ editor, monacoInstance }));

    const s = makeSuggestion('ins', 'insert', 2, 'X');
    act(() => result.current.handleEditSuggestion(s));

    await act(async () => { await result.current.handleAcceptEdit('ins'); });

    expect(executeEdits).toHaveBeenCalledTimes(1);
    const [label, edits] = executeEdits.mock.calls[0];
    expect(label).toBe('accept-ai-suggestion');
    expect(edits).toHaveLength(1);
    expect(edits[0].text).toBe('X');
    expect(edits[0].range.startLineNumber).toBe(2);
    expect(edits[0].range.endLineNumber).toBe(2);
    expect(edits[0].range.startColumn).toBe(1);
    expect(edits[0].range.endColumn).toBe(1); // insert uses column 1
    expect(result.current.totalPendingCount).toBe(0);
  });

  it('accepts a single multi-line replace (correct span)', async () => {
    const { editor, monacoInstance, executeEdits } = createFakeEditor('a\nb\nc\nd');
    const { result } = renderHook(() => useEditSuggestions({ editor, monacoInstance }));

    const s = makeSuggestion('rep', 'replace', 2, 'B\nC2', 2); // replace lines 2-3
    act(() => result.current.handleEditSuggestion(s));

    await act(async () => { await result.current.handleAcceptEdit('rep'); });

    expect(executeEdits).toHaveBeenCalledTimes(1);
    const edits = executeEdits.mock.calls[0][1];
    expect(edits[0].text).toBe('B\nC2');
    expect(edits[0].range.startLineNumber).toBe(2);
    expect(edits[0].range.endLineNumber).toBe(3);
    expect(edits[0].range.endColumn).toBeGreaterThan(1); // end column set to line max
    expect(result.current.totalPendingCount).toBe(0);
  });

  it('accepts a single delete (one line)', async () => {
    const { editor, monacoInstance, executeEdits } = createFakeEditor('a\nb\nc');
    const { result } = renderHook(() => useEditSuggestions({ editor, monacoInstance }));

    const s = makeSuggestion('del', 'delete', 2, '', 1);
    act(() => result.current.handleEditSuggestion(s));

    await act(async () => { await result.current.handleAcceptEdit('del'); });

    expect(executeEdits).toHaveBeenCalledTimes(1);
    const edits = executeEdits.mock.calls[0][1];
    expect(edits[0].text).toBe('');
    expect(edits[0].range.startLineNumber).toBe(2);
    expect(edits[0].range.endLineNumber).toBe(2);
    expect(result.current.totalPendingCount).toBe(0);
  });
});


