import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSSEHeaders } from '@/lib/octra-agent/stream-handling';

export const runtime = 'nodejs';
export const maxDuration = 120;

const DOCUMENT_GENERATION_PROMPT = `You are an expert LaTeX document writer. Generate a complete, compilable LaTeX document based on the user's request.

Requirements:
1. Output ONLY valid LaTeX code - no explanations, no markdown, no code fences
2. The document must compile without errors using pdflatex
3. Use standard packages (amsmath, graphicx, geometry, hyperref, etc.)
4. Include proper document structure: \\documentclass, \\begin{document}, \\end{document}
5. For research papers: include abstract, sections, subsections, and a bibliography section
6. For other documents: use appropriate structure for the document type

The output must start with \\documentclass and end with \\end{document}.`;

interface GenerateRequest {
  prompt: string;
  documentType?: 'research' | 'article' | 'report' | 'letter' | 'general';
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in.' },
        { status: 401 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Service configuration error' },
        { status: 503 }
      );
    }

    const body: GenerateRequest = await request.json();
    const { prompt, documentType = 'general' } = body;

    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    const sessionId = crypto.randomUUID();

    const documentTypeHint =
      documentType === 'research'
        ? 'This should be a formal research paper with abstract, introduction, methodology, results, discussion, and conclusion sections.'
        : documentType === 'article'
          ? 'This should be a well-structured article with clear sections.'
          : documentType === 'report'
            ? 'This should be a formal report with executive summary and detailed sections.'
            : documentType === 'letter'
              ? 'This should be a formal letter with appropriate formatting.'
              : '';

    const fullPrompt = `${prompt}\n\n${documentTypeHint}`.trim();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const write = (event: string, data: unknown) => {
          const payload = JSON.stringify(data);
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${payload}\n\n`)
          );
        };

        try {
          write('session', { id: sessionId });
          write('status', {
            phase: 'generating',
            message: 'Starting document generation...',
          });

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 8192,
              system: DOCUMENT_GENERATION_PROMPT,
              messages: [{ role: 'user', content: fullPrompt }],
              stream: true,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} - ${errorText}`);
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error('No response body');

          const decoder = new TextDecoder();
          let buffer = '';
          let accumulatedContent = '';
          let chunkBuffer = '';
          const CHUNK_SIZE = 100;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const event = JSON.parse(data);
                if (event.type === 'content_block_delta' && event.delta?.text) {
                  accumulatedContent += event.delta.text;
                  chunkBuffer += event.delta.text;

                  if (chunkBuffer.length >= CHUNK_SIZE) {
                    write('content', { text: chunkBuffer, partial: true });
                    chunkBuffer = '';
                  }
                }
              } catch {
                // Skip malformed events
              }
            }
          }

          if (chunkBuffer.length > 0) {
            write('content', { text: chunkBuffer, partial: true });
          }

          const latex = extractLatex(accumulatedContent);

          if (!latex) {
            write('error', {
              message: 'Failed to generate valid LaTeX document',
            });
            controller.close();
            return;
          }

          const title = extractTitle(latex) || 'Untitled Document';

          write('complete', {
            latex,
            title,
            sessionId,
          });

          controller.close();
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Generation failed';
          write('error', { message });
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: createSSEHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to process request', details: message },
      { status: 500 }
    );
  }
}

function extractLatex(content: string): string | null {
  const trimmed = content.trim();

  const fenceMatch = trimmed.match(/```(?:latex|tex)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const extracted = fenceMatch[1].trim();
    if (
      extracted.includes('\\documentclass') &&
      extracted.includes('\\end{document}')
    ) {
      return extracted;
    }
  }

  if (
    trimmed.includes('\\documentclass') &&
    trimmed.includes('\\end{document}')
  ) {
    const start = trimmed.indexOf('\\documentclass');
    const end = trimmed.lastIndexOf('\\end{document}') + '\\end{document}'.length;
    return trimmed.slice(start, end);
  }

  return null;
}

function extractTitle(latex: string): string | null {
  const titleMatch = latex.match(/\\title\{([^}]+)\}/);
  if (titleMatch) {
    return titleMatch[1].replace(/\\\\/g, ' ').trim();
  }
  return null;
}
