import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type * as Monaco from 'monaco-editor';
import { useEditSuggestions } from '@/hooks/use-edit-suggestions';
import { EditSuggestion } from '@/types/edit';

// Minimal fake Monaco editor and model to capture executeEdits calls
class FakeModel {
  private lines: string[];
  constructor(text: string) {
    this.lines = text.split('\n');
  }
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

describe('useEditSuggestions - accept all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

it('applies all edits in one batch, sorted bottom-to-top', async () => {
    const { editor, monacoInstance, executeEdits } = createFakeEditor('a\nb\nc\nd');

    const { result } = renderHook(() => useEditSuggestions({ editor, monacoInstance }));

    const s1 = makeSuggestion('1', 'insert', 2, 'X');            // insert at line 2
    const s2 = makeSuggestion('2', 'replace', 4, 'ZZ', 1);       // replace line 4
    const s3 = makeSuggestion('3', 'delete', 1, '', 1);          // delete line 1

    act(() => result.current.handleEditSuggestion([s1, s2, s3]));

    await act(async () => { await result.current.handleAcceptAllEdits(); });

    expect(executeEdits).toHaveBeenCalledTimes(1);
    const [label, edits] = executeEdits.mock.calls[0];
    expect(label).toBe('accept-all-ai-suggestions');
    // Should contain 3 batched edits
    expect(edits).toHaveLength(3);
    // First edit should be for lower region (line 4) before higher (line 2, 1)
    const startLines = edits.map((e: any) => e.range.startLineNumber);
    expect(startLines).toEqual([4, 2, 1]);
  });

  it('clears queue and in-view suggestions after accept all', async () => {
    const { editor, monacoInstance, executeEdits } = createFakeEditor('line1\nline2');
    const { result } = renderHook(() => useEditSuggestions({ editor, monacoInstance }));

    const many = Array.from({ length: 7 }).map((_, i) => makeSuggestion(`${i}`, 'insert', i + 1, 'X'));

    act(() => result.current.handleEditSuggestion(many));
    // First batch shows 5, queue has 2
    expect(result.current.totalPendingCount).toBe(7);

    await act(async () => { await result.current.handleAcceptAllEdits(); });

    expect(executeEdits).toHaveBeenCalledTimes(1);
    expect(result.current.totalPendingCount).toBe(0);
  });
});


