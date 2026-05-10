import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSSEHeaders } from '@/lib/octra-agent/stream-handling';
import type { ConversationSummary } from '@/types/conversation';
import type { Json, Tables } from '@/database.types';

export const runtime = 'nodejs';
export const maxDuration = 600;

const DOCUMENT_GENERATION_PROMPT = `You are an expert LaTeX document writer. Generate a complete, compilable LaTeX document based on the user's request.

STRICT COMPILATION CONSTRAINTS (MUST FOLLOW):
1.  **Engine**: The document will be compiled with **pdflatex**.
    -   DO NOT use packages that require XeTeX or LuaTeX (e.g., \`fontspec\`, \`unicode-math\`).
    -   DO NOT use packages that require shell-escape (e.g., \`minted\`, \`svg\`, \`auto-pst-pdf\`).
2.  **Fonts**: Use ONLY standard Type 1 fonts compatible with pdflatex.
    -   Approved: \`lmodern\` (default), \`mathptmx\` (Times), \`helvet\` (Helvetica), \`courier\`.
    -   FORBIDDEN: System fonts, TTF/OTF fonts via fontspec.
3.  **Packages**:
    -   USE: \`amsmath\`, \`amssymb\`, \`graphicx\`, \`geometry\`, \`hyperref\`, \`xcolor\`, \`fancyhdr\`, \`enumitem\`, \`booktabs\`, \`caption\`, \`listings\` (for code).
    -   AVOID: \`tcolorbox\` (unless simple), complex tikz libraries that might timeout.
4.  **Structure**:
    -   MUST start with \`\\documentclass{...}\`
    -   MUST end with \`\\end{document}\`
    -   MUST be a single self-contained file (except for provided images).
5.  **Images**:
    -   If the user provided images, use \`\\includegraphics\` with the filenames derived from context.
    -   If NO images provided, use \`draft\` option in graphicx or placeholder rectangles.
6.  **Content**:
    -   Output ONLY valid LaTeX code.
    -   NO markdown, NO code fences, NO explanations before/after.

For research papers: include abstract, sections, subsections, and a bibliography section.
For other documents: use appropriate structure.`;

const CONTINUATION_PROMPT = `You are an expert LaTeX document editor. You will receive an existing LaTeX document along with context about previous modifications, and a new user request.

Your task is to modify the existing document according to the user's new request while maintaining:
1. Document consistency and style
2. All existing content unless explicitly asked to remove it
3. Valid pdflatex-compatible LaTeX

STRICT COMPILATION CONSTRAINTS (MUST FOLLOW):
1. **Engine**: pdflatex only. No XeTeX/LuaTeX packages.
2. **Fonts**: Standard Type 1 fonts only (lmodern, mathptmx, helvet, courier).
3. **Packages**: Use standard packages (amsmath, amssymb, graphicx, geometry, hyperref, xcolor, fancyhdr, enumitem, booktabs, caption, listings).
4. **Output**: Complete, compilable document from \\documentclass to \\end{document}.
5. **Format**: Output ONLY valid LaTeX code. NO markdown, NO code fences, NO explanations.`;

const SUMMARY_PROMPT = `You are a concise summarizer. Given a conversation about a LaTeX document, produce a JSON summary.

Output ONLY valid JSON matching this schema:
{
  "original_intent": "What the user originally wanted to create",
  "modifications_made": ["List of changes made so far"],
  "current_state": "Brief description of the document's current state",
  "interaction_count": <number>
}

Keep total summary under 500 words. Be factual and concise.`;

interface FileData {
  mimeType: string;
  data: string;
  name: string;
}

interface GenerateRequest {
  prompt: string;
  documentType?: 'research' | 'article' | 'report' | 'letter' | 'general';
  files?: FileData[];
  documentId?: string;
  currentLatex?: string;
  lastUserPrompt?: string | null;
  lastAssistantResponse?: string | null;
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
    const {
      prompt,
      documentType = 'general',
      files,
      documentId,
      currentLatex,
      lastUserPrompt,
      lastAssistantResponse,
    } = body;

    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    const isContinuation = !!documentId;
    const sessionId = documentId || crypto.randomUUID();

    let systemPrompt: string;
    let userContent: string;
    let effectiveLatex = currentLatex ?? '';
    let effectiveLastUserPrompt = lastUserPrompt ?? null;
    let effectiveLastAssistantResponse = lastAssistantResponse ?? null;
    let effectiveSummary: ConversationSummary | null = null;
    let fallbackExchanges: Exchange[] = [];

    if (isContinuation) {
      const continuationDocumentId = documentId as string;
      const { data: document, error: documentError } = await (supabase
        .from('generated_documents') as any)
        .select('id, latex, message_history, conversation_summary, last_user_prompt, last_assistant_response, interaction_count')
        .eq('id', continuationDocumentId)
        .eq('user_id', user.id)
        .single();

      if (documentError || !document) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const continuationDocument = document as ContinuationDocument;

      effectiveLatex = currentLatex || continuationDocument.latex || '';
      if (!effectiveLatex.trim()) {
        return NextResponse.json({ error: 'Current document is required for continuation' }, { status: 400 });
      }

      effectiveLastUserPrompt = continuationDocument.last_user_prompt ?? effectiveLastUserPrompt;
      effectiveLastAssistantResponse = continuationDocument.last_assistant_response ?? effectiveLastAssistantResponse;
      fallbackExchanges = extractCompleteExchanges(continuationDocument.message_history).slice(-3);
      effectiveSummary = await ensureConversationSummary({
        supabase,
        apiKey,
        userId: user.id,
        document: continuationDocument,
      });

      systemPrompt = CONTINUATION_PROMPT;

      const contextParts: string[] = [];
      contextParts.push(`CURRENT DOCUMENT:\n\`\`\`latex\n${effectiveLatex}\n\`\`\``);

      if (effectiveSummary) {
        contextParts.push(`\nCONVERSATION CONTEXT:\n- Original intent: ${effectiveSummary.original_intent}\n- Modifications made: ${effectiveSummary.modifications_made.join(', ') || 'None yet'}\n- Current state: ${effectiveSummary.current_state}`);
      } else if (fallbackExchanges.length > 0) {
        contextParts.push(
          `\nRECENT EXCHANGES:\n${fallbackExchanges
            .map((exchange, index) => `${index + 1}. User: ${exchange.userPrompt}\nAssistant: ${exchange.assistantResponse}`)
            .join('\n')}`
        );
      }

      if (effectiveLastUserPrompt && effectiveLastAssistantResponse) {
        contextParts.push(`\nLAST EXCHANGE:\nUser asked: ${effectiveLastUserPrompt}\nResult: Document was updated accordingly.`);
      }

      contextParts.push(`\nNEW REQUEST:\n${prompt}`);
      userContent = contextParts.join('\n');
    } else {
      systemPrompt = DOCUMENT_GENERATION_PROMPT;

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

      userContent = `${prompt}\n\n${documentTypeHint}`.trim();
    }

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

          const messageContent: unknown[] = [];

          if (files && files.length > 0) {
            for (const file of files) {
              if (file.mimeType.startsWith('image/')) {
                messageContent.push({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: file.mimeType,
                    data: file.data,
                  },
                });
              } else if (file.mimeType === 'application/pdf') {
                messageContent.push({
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: file.mimeType,
                    data: file.data,
                  },
                });
              }
            }
          }

          messageContent.push({ type: 'text', text: userContent });

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
              system: systemPrompt,
              messages: [{ role: 'user', content: messageContent }],
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

          write('status', { phase: 'finalizing', message: 'Finalizing document...' });

          const latex = extractLatex(accumulatedContent);

          if (!latex) {
            write('error', {
              message: 'Failed to generate valid LaTeX document',
            });
            controller.close();
            return;
          }

          let title = extractTitle(latex);
          
          if (!title) {
            const cleanPrompt = prompt.replace(/\s+/g, ' ').trim();
            title = cleanPrompt.length > 50 
              ? cleanPrompt.slice(0, 50) + '...' 
              : cleanPrompt;
              
            if (!title) title = 'Untitled Document';
          }

          write('complete', {
            latex,
            title,
            sessionId,
            isContinuation,
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

interface Exchange {
  userPrompt: string;
  assistantResponse: string;
}

type ContinuationDocument = Pick<
  Tables<'generated_documents'>,
  'id' | 'latex' | 'message_history' | 'conversation_summary' | 'last_user_prompt' | 'last_assistant_response' | 'interaction_count'
>;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseConversationSummary(value: Json | null): ConversationSummary | null {
  if (!isObject(value)) return null;
  const { original_intent, modifications_made, current_state, interaction_count } = value;
  if (
    typeof original_intent === 'string' &&
    Array.isArray(modifications_made) &&
    modifications_made.every((entry) => typeof entry === 'string') &&
    typeof current_state === 'string' &&
    typeof interaction_count === 'number'
  ) {
    return {
      original_intent,
      modifications_made,
      current_state,
      interaction_count,
    };
  }
  return null;
}

function extractCompleteExchanges(history: Json | null): Exchange[] {
  if (!Array.isArray(history)) return [];
  const exchanges: Exchange[] = [];
  let pendingUserPrompt: string | null = null;

  for (const entry of history) {
    if (!isObject(entry)) continue;
    const role = entry.role;
    const content = entry.content;
    if (role === 'user' && typeof content === 'string' && content.trim()) {
      pendingUserPrompt = content.trim();
      continue;
    }
    if (role === 'assistant' && pendingUserPrompt && typeof content === 'string' && content.trim()) {
      exchanges.push({
        userPrompt: pendingUserPrompt,
        assistantResponse: content.trim(),
      });
      pendingUserPrompt = null;
    }
  }

  return exchanges;
}

function parseSummaryFromModel(text: string, fallback: ConversationSummary | null, interactionCount: number): ConversationSummary {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    const parsed = JSON.parse(jsonMatch[0]) as ConversationSummary;
    if (
      typeof parsed.original_intent === 'string' &&
      Array.isArray(parsed.modifications_made) &&
      parsed.modifications_made.every((entry) => typeof entry === 'string') &&
      typeof parsed.current_state === 'string' &&
      typeof parsed.interaction_count === 'number'
    ) {
      return parsed;
    }
    throw new Error('Invalid summary schema');
  } catch {
    if (fallback) {
      return {
        ...fallback,
        interaction_count: interactionCount,
      };
    }
    return {
      original_intent: 'Document creation',
      modifications_made: [],
      current_state: 'Document updated',
      interaction_count: interactionCount,
    };
  }
}

async function generateSummary(
  apiKey: string,
  currentSummary: ConversationSummary | null,
  exchanges: Exchange[],
  interactionCount: number
): Promise<ConversationSummary | null> {
  if (exchanges.length === 0) return currentSummary;

  const prompt = currentSummary
    ? `Previous summary:\n${JSON.stringify(currentSummary, null, 2)}\n\nNew exchanges to incorporate:\n${exchanges
        .map((e, i) => `Exchange ${i + 1}:\nUser: ${e.userPrompt}\nAssistant: ${e.assistantResponse}`)
        .join('\n\n')}\n\nUpdate the summary to include these new interactions. Set interaction_count to ${interactionCount}.`
    : `Conversation so far:\n${exchanges
        .map((e, i) => `Exchange ${i + 1}:\nUser: ${e.userPrompt}\nAssistant: ${e.assistantResponse}`)
        .join('\n\n')}\n\nCreate an initial summary. Set interaction_count to ${interactionCount}.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system: SUMMARY_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) return currentSummary;
    const result = await response.json();
    const content = result.content?.[0]?.text || '';
    return parseSummaryFromModel(content, currentSummary, interactionCount);
  } catch {
    return currentSummary;
  }
}

async function ensureConversationSummary(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  apiKey: string;
  userId: string;
  document: ContinuationDocument;
}): Promise<ConversationSummary | null> {
  const { supabase, apiKey, userId, document } = params;
  const currentSummary = parseConversationSummary(document.conversation_summary);
  const exchanges = extractCompleteExchanges(document.message_history);
  const completedInteractionCount = exchanges.length;

  if (completedInteractionCount < 2) {
    return currentSummary;
  }

  if (currentSummary && currentSummary.interaction_count >= completedInteractionCount) {
    return currentSummary;
  }

  const unsummarizedExchanges =
    currentSummary && currentSummary.interaction_count > 0
      ? exchanges.slice(currentSummary.interaction_count)
      : exchanges;

  const updatedSummary = await generateSummary(
    apiKey,
    currentSummary,
    unsummarizedExchanges,
    completedInteractionCount
  );

  if (!updatedSummary) return currentSummary;

  await (supabase.from('generated_documents') as any)
    .update({ conversation_summary: updatedSummary })
    .eq('id', document.id)
    .eq('user_id', userId);

  return updatedSummary;
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
