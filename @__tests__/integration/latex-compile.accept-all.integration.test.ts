import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StringEdit } from '@/lib/octra-agent/edits';
import { POST as compileRoute } from '@/app/api/compile-pdf/route';
import { applyEditToContent } from '@/hooks/use-edit-suggestions/suggestion-operations';
import type { EditSuggestion } from '@/types/edit';
import { mockPdfResponse } from '../helpers/responses';

// The route reads COMPILE_SERVICE_URL at import time; vi.hoisted runs before the imports above
vi.hoisted(() => {
  process.env.COMPILE_SERVICE_URL = 'https://compile.test';
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    },
  }),
}));

const baseTex = String.raw`\documentclass{article}
\title{Test Document}
\begin{document}
\maketitle
\section{Intro}
Hello.
\end{document}`;

function acceptAll(text: string, edits: StringEdit[]): string {
  return edits.reduce(
    (content, edit, i) =>
      applyEditToContent(content, { ...edit, id: String(i), status: 'pending' } as EditSuggestion),
    text
  );
}

describe('LaTeX compilation after batched edits', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('applies edits and compiles via the route (mocked remote)', async () => {
    const edits: StringEdit[] = [
      { file_path: 'main.tex', old_string: String.raw`\title{Test Document}`, new_string: String.raw`\title{Test Document (v2)}` },
      { file_path: 'main.tex', old_string: 'Hello.', new_string: 'Hello.\nThis is an inserted sentence.' },
      { file_path: 'main.tex', old_string: String.raw`\end{document}`, new_string: String.raw`\section{Added}
A new section.
\end{document}` },
    ];
    const finalTex = acceptAll(baseTex, edits);
    expect(finalTex).toContain(String.raw`\title{Test Document (v2)}`);
    expect(finalTex).toContain(String.raw`\section{Added}`);

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockPdfResponse());

    const res = await compileRoute(
      new Request('http://localhost/api/compile-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: finalTex }),
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.pdf).toBeTruthy();

    // The route forwards the edited document to the compile service with the session token
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://compile.test/compile');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(JSON.parse(init.body as string).files).toEqual([{ path: 'main.tex', content: finalTex }]);
  });
});
