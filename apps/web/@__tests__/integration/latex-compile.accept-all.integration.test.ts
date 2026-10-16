import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST as compileRoute } from '@/app/api/compile-pdf/route';

// Minimal LaTeX fixture that compiles
const baseTex = String.raw`\documentclass{article}
\usepackage[utf8]{inputenc}
\title{Test Document}
\author{Unit Test}
\date{\\today}
\begin{document}
\maketitle
\section{Intro}
Hello.
\end{document}`;

type Edit = {
  editType: 'insert' | 'replace' | 'delete';
  position: { line: number };
  content?: string;
  originalLineCount?: number;
};

// Apply line-based edits to plain text (sorted bottom-to-top like Accept All)
function applyLineEditsBatch(text: string, edits: Edit[]): string {
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

// Create a fake PDF response ("%PDF") so the route validates the magic bytes
function mockPdfResponse(): Response {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x0a]); // %PDF\n
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'x-compile-request-id': 'test',
      'x-compile-duration-ms': '10',
      'x-compile-queue-ms': '0',
    },
  });
}

describe('LaTeX compilation after batched edits', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Ensure the route takes the development path (uses remote service branch)
    process.env.ENVIRONMENT = 'dev';
    // Provide a dummy URL so route builds a valid request URL
    process.env.COMPILE_SERVICE_URL = process.env.COMPILE_SERVICE_URL || 'https://example.com';
  });

  it('applies edits and compiles via the route (mocked remote)', async () => {
    // 1) Create a few edits that keep the doc valid
    const edits: Edit[] = [
      { editType: 'replace', position: { line: 3 }, content: String.raw`\\title{Test Document (v2)}`, originalLineCount: 1 },
      { editType: 'insert', position: { line: 8 }, content: String.raw`This is an inserted sentence.` },
      { editType: 'insert', position: { line: 9 }, content: String.raw`\\section{Added}
A new section.` },
    ];

    const finalTex = applyLineEditsBatch(baseTex, edits);

    // 2) Mock remote compilation to return a PDF-like response
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockPdfResponse());

    // 3) Call the route directly
    const req = new Request('http://localhost/api/compile-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: finalTex }),
    });

    const res = await compileRoute(req as unknown as Request);
    const json = await (res as Response).json();

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(json.pdf).toBeTruthy();
  });
});


