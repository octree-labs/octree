import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useFirstEditNudge } from '@/hooks/use-first-edit-nudge';
import { markAiEditRequested, markNudgeShown, wasNudgeShown } from '@/lib/first-edit-nudge';
import { track } from '@/lib/analytics/track';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'user-1' } } } }),
    },
  }),
}));

vi.mock('@/lib/analytics/track', () => ({
  track: vi.fn(),
}));

const mockedTrack = vi.mocked(track);
/** Let the session promise and the effects settle. */
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const latex = '\\begin{abstract}x\\end{abstract} \\cite{a}';

function renderNudge(initial: { pdfData?: string | null; usageLoading?: boolean; usage?: any } = {}) {
  return renderHook(
    (props: { pdfData: string | null; usageLoading: boolean; usage: any }) =>
      useFirstEditNudge({ content: latex, ...props }),
    {
      initialProps: {
        pdfData: initial.pdfData ?? null,
        usageLoading: initial.usageLoading ?? false,
        usage: initial.usage ?? { isPro: false, editCount: 0, monthlyEditCount: 0 },
      },
    }
  );
}

describe('useFirstEditNudge', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedTrack.mockClear();
  });

  it('stays hidden until a compile produces a PDF, then shows once and records it', async () => {
    const { result, rerender } = renderNudge();
    await waitFor(() => expect(result.current.suggestions).toBeNull());

    rerender({ pdfData: 'JVBERi0=', usageLoading: false, usage: { isPro: false } });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(3));

    expect(result.current.suggestions?.map((s) => s.id)).toEqual([
      'fix_formatting',
      'tighten_abstract',
      'check_citations',
    ]);
    expect(wasNudgeShown('user-1')).toBe(true);
    expect(mockedTrack).toHaveBeenCalledWith('first_edit_nudge_shown', {
      suggestions: ['fix_formatting', 'tighten_abstract', 'check_citations'],
    });
  });

  it('waits for the plan to load, then skips a user whose counters show edits', async () => {
    const { result, rerender } = renderNudge({ pdfData: 'JVBERi0=', usageLoading: true });
    await flush();
    expect(result.current.suggestions).toBeNull();

    rerender({ pdfData: 'JVBERi0=', usageLoading: false, usage: { isPro: false, editCount: 2 } });
    await flush();
    expect(result.current.suggestions).toBeNull();
    expect(wasNudgeShown('user-1')).toBe(false);
    expect(mockedTrack).not.toHaveBeenCalled();
  });

  it('never shows again once shown, nor to a user who has asked for an AI edit before', async () => {
    markNudgeShown('user-1');
    const shown = renderNudge({ pdfData: 'JVBERi0=' });
    await flush();
    expect(shown.result.current.suggestions).toBeNull();

    window.localStorage.clear();
    markAiEditRequested('user-1');
    const edited = renderNudge({ pdfData: 'JVBERi0=' });
    await flush();
    expect(edited.result.current.suggestions).toBeNull();
    expect(mockedTrack).not.toHaveBeenCalled();
  });

  it('choosing a prompt hides the card and marks the user as having edited', async () => {
    const { result } = renderNudge({ pdfData: 'JVBERi0=' });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(3));

    act(() => result.current.choose(result.current.suggestions![1]));
    expect(result.current.suggestions).toBeNull();
    expect(mockedTrack).toHaveBeenCalledWith('first_edit_nudge_clicked', {
      suggestion: 'tighten_abstract',
    });
    expect(window.localStorage.getItem('octree:ai-edit-requested:user-1')).not.toBeNull();
  });

  it('the X hides the card and reports the dismissal once', async () => {
    const { result } = renderNudge({ pdfData: 'JVBERi0=' });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(3));

    act(() => result.current.dismiss());
    act(() => result.current.dismiss());
    expect(result.current.suggestions).toBeNull();
    expect(mockedTrack.mock.calls.filter(([e]) => e === 'first_edit_nudge_dismissed')).toHaveLength(1);
  });

  it('an AI edit typed into the chat (usage-update) closes the card for good', async () => {
    const { result } = renderNudge({ pdfData: 'JVBERi0=' });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(3));

    act(() => {
      window.dispatchEvent(new Event('usage-update'));
    });
    expect(result.current.suggestions).toBeNull();
    expect(window.localStorage.getItem('octree:ai-edit-requested:user-1')).not.toBeNull();
  });
});
