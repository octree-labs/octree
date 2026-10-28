import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { EditSuggestion } from '@/types/edit';
import { createFakeEditor } from '../helpers/fake-monaco';

/**
 * ATS fixes (source 'ats') are a Pro feature of their own: applying them must
 * not need AI edits left, while AI chat edits stay behind the allowance.
 */

const mocks = vi.hoisted(() => ({
  canEdit: false,
  openPaywall: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@/hooks/use-edit-limit-cache', () => ({
  useEditLimitCache: () => ({ canEdit: mocks.canEdit, isPro: false }),
}));
vi.mock('@/stores/paywall', () => ({ PaywallActions: { open: mocks.openPaywall } }));
vi.mock('@/lib/analytics/track', () => ({ track: mocks.track }));

import { useEditSuggestions } from '@/hooks/use-edit-suggestions';

function suggestion(id: string, old_string: string, new_string: string, source?: 'ats'): EditSuggestion {
  return { id, file_path: 'main.tex', old_string, new_string, status: 'pending', ...(source ? { source } : {}) };
}

function setup(initial: string) {
  const fake = createFakeEditor(initial);
  const { result } = renderHook(() =>
    useEditSuggestions({ editor: fake.editor, monacoInstance: fake.monacoInstance })
  );
  return { ...fake, result };
}

describe('useEditSuggestions - ATS fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canEdit = false;
  });

  it('applies ATS fixes with no AI edits left, and records no AI edit', async () => {
    const { result, model } = setup('Responsible for managing the API\nWorked on tests');
    act(() =>
      result.current.handleEditSuggestion([
        suggestion('1', 'Responsible for managing', 'Managed', 'ats'),
        suggestion('2', 'Worked on tests', 'Wrote tests', 'ats'),
      ])
    );

    await act(async () => { await result.current.handleAcceptAllEdits(); });

    expect(model.getValue()).toBe('Managed the API\nWrote tests');
    expect(mocks.openPaywall).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('applies a single ATS fix with no AI edits left', async () => {
    const { result, model } = setup('Helped with migrating X');
    act(() => result.current.handleEditSuggestion(suggestion('1', 'Helped with', 'Contributed to', 'ats')));

    await act(async () => { await result.current.handleAcceptEdit('1'); });

    expect(model.getValue()).toBe('Contributed to migrating X');
    expect(mocks.openPaywall).not.toHaveBeenCalled();
  });

  it('still blocks AI chat edits at the limit, even mixed with ATS fixes', async () => {
    const { result, model } = setup('a\nb');
    act(() =>
      result.current.handleEditSuggestion([suggestion('1', 'a', 'A', 'ats'), suggestion('2', 'b', 'B')])
    );

    await act(async () => { await result.current.handleAcceptAllEdits(); });

    expect(model.getValue()).toBe('a\nb');
    expect(mocks.openPaywall).toHaveBeenCalledWith('ai-edit');
  });

  it('counts only the AI chat edits when the allowance is there', async () => {
    mocks.canEdit = true;
    const { result } = setup('a\nb\nc');
    act(() =>
      result.current.handleEditSuggestion([
        suggestion('1', 'a', 'A', 'ats'),
        suggestion('2', 'b', 'B'),
        suggestion('3', 'c', 'C'),
      ])
    );

    await act(async () => { await result.current.handleAcceptAllEdits(); });

    expect(mocks.track).toHaveBeenCalledWith(expect.anything(), { count: 2, mode: 'all' });
  });
});
