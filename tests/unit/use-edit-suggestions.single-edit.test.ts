import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';
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

describe('useEditSuggestions - single edit acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replaces the unique match of old_string', async () => {
    const { result, executeEdits, model } = setup('a\nb\nc');

    act(() => result.current.handleEditSuggestion(makeSuggestion('rep', 'b', 'B')));
    await act(async () => { await result.current.handleAcceptEdit('rep'); });

    expect(executeEdits).toHaveBeenCalledTimes(1);
    const [label, edits] = executeEdits.mock.calls[0];
    expect(label).toBe('accept-ai-suggestion');
    expect(edits).toHaveLength(1);
    expect(edits[0].text).toBe('B');
    expect(edits[0].range).toMatchObject({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 });
    expect(model.getValue()).toBe('a\nB\nc');
    expect(result.current.totalPendingCount).toBe(0);
  });

  it('replaces a multi-line span', async () => {
    const { result, executeEdits, model } = setup('a\nb\nc\nd');

    act(() => result.current.handleEditSuggestion(makeSuggestion('rep', 'b\nc', 'B\nC2')));
    await act(async () => { await result.current.handleAcceptEdit('rep'); });

    const [, edits] = executeEdits.mock.calls[0];
    expect(edits[0].range).toMatchObject({ startLineNumber: 2, endLineNumber: 3 });
    expect(model.getValue()).toBe('a\nB\nC2\nd');
    expect(result.current.totalPendingCount).toBe(0);
  });

  it('deletes text when new_string is empty', async () => {
    const { result, model } = setup('a\nb\nc');

    act(() => result.current.handleEditSuggestion(makeSuggestion('del', 'b\n', '')));
    await act(async () => { await result.current.handleAcceptEdit('del'); });

    expect(model.getValue()).toBe('a\nc');
    expect(result.current.totalPendingCount).toBe(0);
  });

  it('appends to the end of the file when old_string is empty', async () => {
    const { result, executeEdits, model } = setup('a\nb');

    act(() => result.current.handleEditSuggestion(makeSuggestion('app', '', '\nc')));
    await act(async () => { await result.current.handleAcceptEdit('app'); });

    const [, edits] = executeEdits.mock.calls[0];
    expect(edits[0].range).toMatchObject({ startLineNumber: 2, startColumn: 2, endLineNumber: 2, endColumn: 2 });
    expect(model.getValue()).toBe('a\nb\nc');
  });

  it('does not apply an edit whose old_string matches more than once', async () => {
    const { result, executeEdits, model } = setup('x\nx');

    act(() => result.current.handleEditSuggestion(makeSuggestion('dup', 'x', 'y')));
    await act(async () => { await result.current.handleAcceptEdit('dup'); });

    expect(executeEdits).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(model.getValue()).toBe('x\nx');
    expect(result.current.totalPendingCount).toBe(1);
  });

  it('drops pending suggestions invalidated by an accepted edit', async () => {
    const { result } = setup('foo bar');

    act(() =>
      result.current.handleEditSuggestion([
        makeSuggestion('whole', 'foo bar', 'baz'),
        makeSuggestion('part', 'bar', 'qux'), // 'bar' no longer exists after 'whole' is accepted
      ])
    );
    expect(result.current.totalPendingCount).toBe(2);

    await act(async () => { await result.current.handleAcceptEdit('whole'); });

    expect(result.current.totalPendingCount).toBe(0);
    expect(result.current.editSuggestions.map((s) => s.id)).toEqual(['whole']);
  });
});
