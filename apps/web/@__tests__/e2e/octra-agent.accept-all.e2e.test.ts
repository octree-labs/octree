import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST as compileRoute } from '@/app/api/compile-pdf/route';

// Minimal LaTeX document fixture
const baseTex = String.raw`\documentclass{article}
\usepackage[utf8]{inputenc}
\title{E2E Document}
\author{Octra}
\date{\\today}
\begin{document}
\maketitle
\section{Intro}
Hello.
\end{document}`;

type LineEdit = {
  editType: 'insert' | 'replace' | 'delete';
  content?: string;
  position: { line: number };
  originalLineCount?: number;
};

function sseResponse(events: Array<{ event: string; data: any }>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        const payload = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
        controller.enqueue(enc.encode(`event: ${e.event}\n`));
        controller.enqueue(enc.encode(`data: ${payload}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream as unknown as BodyInit, {
    headers: { 'content-type': 'text/event-stream' },
    status: 200,
  });
}

function applyLineEditsBatch(text: string, edits: LineEdit[]): string {
  const lines = text.split('\n');
  const sorted = [...edits].sort((a, b) => b.position.line - a.position.line);
  for (const e of sorted) {
    const idx = Math.max(0, Math.min(lines.length, e.position.line - 1));
    const count = e.originalLineCount ?? (e.editType === 'insert' ? 0 : 1);
    if (e.editType === 'insert') {
      const insertLines = (e.content || '').split('\n');
      lines.splice(idx, 0, ...insertLines);
    } else if (e.editType === 'replace') {
      const newLines = (e.content || '').split('\n');
      lines.splice(idx, count, ...newLines);
    } else if (e.editType === 'delete') {
      lines.splice(idx, count);
    }
  }
  return lines.join('\n');
}

function mockPdfResponse(): Response {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x0a]);
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'x-compile-request-id': 'test',
    },
  });
}

describe('Octra Agent E2E (proxied SSE) -> compile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Force route to use proxy branch and mock SSE
    process.env.CLAUDE_AGENT_SERVICE_URL = 'https://fake-octra-agent';
  });

  it('streams edits from agent, applies Accept All semantics, compiles', async () => {
    // Mock Supabase server helpers before importing the route
    vi.resetModules();
    vi.mock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: 'user_1', email: 'test@example.com' } }, error: null }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  edit_count: 0,
                  monthly_edit_count: 0,
                  is_pro: true,
                  daily_reset_date: null,
                  monthly_reset_date: null,
                },
                error: null,
              }),
            }),
          }),
        }),
        rpc: async () => ({ data: true, error: null }),
      }),
    }));

    const { POST: octraRoute } = await import('@/app/api/octra-agent/route');
    // 1) Prepare a streamed SSE with propose_edits and edits payload
    const edits: LineEdit[] = [
      { editType: 'replace', position: { line: 3 }, content: String.raw`\\title{E2E Document (Edited)}`, originalLineCount: 1 },
      { editType: 'insert', position: { line: 8 }, content: 'Inserted from agent.' },
    ];
    const sse = sseResponse([
      { event: 'status', data: { state: 'started' } },
      { event: 'tool', data: { name: 'propose_edits', count: edits.length } },
      { event: 'edits', data: edits },
      { event: 'assistant_message', data: { text: 'Proposed edits.' } },
      { event: 'result', data: { text: 'done' } },
    ]);

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      // First call: proxy to remote agent
      .mockResolvedValueOnce(sse)
      // Second call: compile route remote call
      .mockResolvedValueOnce(mockPdfResponse());

    // 2) Call Octra agent route (proxied)
    const octraReq = new Request('http://localhost/api/octra-agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Insert a new line and tweak title' }],
        fileContent: baseTex,
      }),
    });

    const octraRes = (await octraRoute(octraReq as unknown as Request)) as Response;
    expect(octraRes.status).toBe(200);

    // 3) Read back streamed events and extract edits
    const reader = octraRes.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const received: Array<{ event: string; data: any }> = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const em = /event:\s*(\S+)/.exec(raw);
        const dm = /data:\s*([\s\S]+)/.exec(raw);
        if (em && dm) {
          const event = em[1];
          let data: any;
          try { data = JSON.parse(dm[1]); } catch { data = dm[1]; }
          received.push({ event, data });
        }
      }
    }

    // Should have received edits from the streamed proxy
    const editsEvent = received.find((e) => e.event === 'edits');
    expect(editsEvent).toBeTruthy();
    const agentEdits = editsEvent!.data as LineEdit[];

    // 4) Apply Accept All semantics and compile
    const finalTex = applyLineEditsBatch(baseTex, agentEdits);

    const compileReq = new Request('http://localhost/api/compile-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: finalTex }),
    });
    const compileRes = (await compileRoute(compileReq as unknown as Request)) as Response;
    const json = await compileRes.json();

    // Verify remote agent and compile were called
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(json.pdf).toBeTruthy();
  });
});


