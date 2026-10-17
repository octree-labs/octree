import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StringEdit } from '@/lib/octra-agent/edits';
import { POST as compileRoute } from '@/app/api/compile-pdf/route';
import { POST as octraRoute } from '@/app/api/octra-agent/route';
import { applyEditToContent } from '@/hooks/use-edit-suggestions/suggestion-operations';
import type { EditSuggestion } from '@/types/edit';
import { mockPdfResponse, readSse, sseResponse } from '../helpers/responses';

// Both routes read env at import/request time; vi.hoisted runs before the imports above
const { rpc } = vi.hoisted(() => {
  process.env.COMPILE_SERVICE_URL = 'https://compile.test';
  process.env.CLAUDE_AGENT_SERVICE_URL = 'https://agent.test/agent';
  return { rpc: vi.fn(async () => ({ data: true, error: null })) };
});

// Logged-in Pro user with edits remaining (not on the unlimited-edits whitelist)
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: { access_token: 'test-token', user: { id: 'user_1', email: 'test@example.com' } },
        },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { edit_count: 0, monthly_edit_count: 0, is_pro: true, daily_reset_date: null, monthly_reset_date: null },
            error: null,
          }),
        }),
      }),
    }),
    rpc,
  }),
}));

const baseTex = String.raw`\documentclass{article}
\title{E2E Document}
\begin{document}
\maketitle
\section{Intro}
Hello.
\end{document}`;

describe('Octra Agent E2E (proxied SSE) -> compile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rpc.mockClear();
  });

  it('streams edits from agent, applies Accept All semantics, compiles', async () => {
    const agentEdits = [
      { file_path: 'main.tex', old_string: String.raw`\title{E2E Document}`, new_string: String.raw`\title{E2E Document (Edited)}` },
      { file_path: 'main.tex', old_string: 'Hello.', new_string: 'Hello.\nInserted from agent.' },
    ] satisfies StringEdit[];

    // The events the agent server emits for a turn that proposes edits
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        sseResponse([
          { event: 'status', data: { state: 'started' } },
          { event: 'tool', data: { name: 'propose_edits', count: agentEdits.length } },
          { event: 'edits', data: agentEdits },
          { event: 'assistant_partial', data: { text: 'Proposed edits.' } },
          { event: 'done', data: { text: 'Proposed edits.', edits: agentEdits } },
        ])
      )
      .mockResolvedValueOnce(mockPdfResponse());

    // 1) Proxy the request to the agent and read the stream back
    const agentRequest = {
      messages: [{ role: 'user', content: 'Insert a new line and tweak title' }],
      fileContent: baseTex,
      projectFiles: [{ path: 'main.tex', content: baseTex }],
      currentFilePath: 'main.tex',
    };

    const octraRes = await octraRoute(
      new Request('http://localhost/api/octra-agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(agentRequest),
      })
    );
    expect(octraRes.status).toBe(200);

    const received = await readSse(octraRes);
    expect(received.map((e) => e.event)).toEqual(['status', 'tool', 'edits', 'assistant_partial', 'done']);

    // The proxy counted the edit and forwarded the request with the user's token
    expect(rpc).toHaveBeenCalledWith('increment_edit_count', { p_user_id: 'user_1' });
    const [agentUrl, agentInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(agentUrl).toBe('https://agent.test/agent');
    expect((agentInit.headers as Record<string, string>).authorization).toBe('Bearer test-token');
    expect(JSON.parse(agentInit.body as string)).toEqual(agentRequest);

    // 2) Accept all streamed edits
    const streamedEdits = received.find((e) => e.event === 'edits')!.data as StringEdit[];
    const finalTex = streamedEdits.reduce(
      (content, edit, i) =>
        applyEditToContent(content, { ...edit, id: String(i), status: 'pending' } as EditSuggestion),
      baseTex
    );
    expect(finalTex).toContain(String.raw`\title{E2E Document (Edited)}`);
    expect(finalTex).toContain('Inserted from agent.');

    // 3) Compile the edited document
    const compileRes = await compileRoute(
      new Request('http://localhost/api/compile-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: finalTex }),
      })
    );
    const json = await compileRes.json();

    expect(compileRes.status).toBe(200);
    expect(json.pdf).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe('https://compile.test/compile');
  });
});
