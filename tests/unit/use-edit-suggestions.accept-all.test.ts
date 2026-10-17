import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditSuggestions } from '@/hooks/use-edit-suggestions';
import type { EditSuggestion } from '@/types/edit';
import { createFakeEditor } from '../helpers/fake-monaco';

function makeSuggestion(id: string, old_string: string, new_string: string): EditSuggestion {
  return { id, file_path: 'main.tex', old_string, new_string, status: 'pending' };
}

function setup(initial: string) {
  const fake = createFakeEditor(initial);
  const { result } = renderHook(() =>
    useEditSuggestions({ editor: fake.editor, monacoInstance: fake.monacoInstance })
  );
  return { ...fake, result };
}

describe('useEditSuggestions - accept all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies all edits in one batch, sorted bottom-to-top', async () => {
    const { result, executeEdits, model } = setup('a\nb\nc\nd');

    act(() =>
      result.current.handleEditSuggestion([
        makeSuggestion('1', 'b', 'B'), // line 2
        makeSuggestion('2', 'd', 'D'), // line 4
        makeSuggestion('3', 'a\n', ''), // line 1 (delete)
      ])
    );

    await act(async () => { await result.current.handleAcceptAllEdits(); });

    expect(executeEdits).toHaveBeenCalledTimes(1);
    const [label, edits] = executeEdits.mock.calls[0];
    expect(label).toBe('accept-all-ai-suggestions');
    expect(edits).toHaveLength(3);
    expect(edits.map((e: any) => e.range.startLineNumber)).toEqual([4, 2, 1]);
    expect(model.getValue()).toBe('B\nc\nD');
  });

  it('clears all pending suggestions after accept all', async () => {
    const lines = Array.from({ length: 7 }, (_, i) => `line${i + 1}`);
    const { result, executeEdits, model } = setup(lines.join('\n'));

    act(() =>
      result.current.handleEditSuggestion(
        lines.map((line, i) => makeSuggestion(`${i}`, line, line.toUpperCase()))
      )
    );
    expect(result.current.totalPendingCount).toBe(7);

    await act(async () => { await result.current.handleAcceptAllEdits(); });

    expect(executeEdits).toHaveBeenCalledTimes(1);
    expect(result.current.totalPendingCount).toBe(0);
    expect(model.getValue()).toBe(lines.map((l) => l.toUpperCase()).join('\n'));
  });
});
