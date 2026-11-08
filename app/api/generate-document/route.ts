import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  captureServerEventAfterResponse,
  captureServerExceptionAfterResponse,
} from '@/lib/posthog-server';
import { hasUnlimitedEdits } from '@/lib/paywall';
import { createSSEHeaders } from '@/lib/octra-agent/stream-handling';
import { AnalyticsEvents, type GenerationKind } from '@/lib/analytics/events';
import {
  classifyGenerationEnd,
  GENERATE_DEADLINE_MS,
  GENERATE_MAX_OUTPUT_TOKENS,
  TRUNCATED_MESSAGE,
  UPSTREAM_MESSAGE,
} from '@/lib/generate/output';
import { checkGenerateTextLength } from '@/lib/generate/limits';
import type { ConversationSummary } from '@/types/conversation';

export const runtime = 'nodejs';
// Fluid Compute ceiling on Pro. Long documents stream for several minutes;
// GENERATE_DEADLINE_MS stops reading the model a minute before this.
export const maxDuration = 800;

/** Cut-off documents refunded per user per rolling 24 hours. */
const TRUNCATION_REFUNDS_PER_DAY = 2;

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
  conversationSummary?: ConversationSummary | null;
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
      conversationSummary,
      lastUserPrompt,
      lastAssistantResponse,
    } = body;

    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Before the allowance is touched: a huge paste is refused, not billed.
    const lengthError = checkGenerateTextLength({
      promptLength: prompt.length,
      currentLatexLength: typeof currentLatex === 'string' ? currentLatex.length : 0,
    });
    if (lengthError) {
      return NextResponse.json({ error: lengthError, code: 'too_long' }, { status: 400 });
    }

    // Allowance: Pro is unlimited; everyone else gets one free generation,
    // then credits bought through Checkout. `consume_generation` is a
    // SECURITY DEFINER, self-only RPC (the user_usage guard trigger refuses
    // these columns from the user session), so it runs on the user's client.
    //
    // It is consumed here, after the request has been validated and just
    // before the model call, and handed back (`refund_generation`, service
    // role only, so it goes through the admin client) if the model produced
    // nothing, so a provider outage never costs the free one.
    const kind = await consumeGeneration(supabase, user);
    if (kind === 'error') {
      // Fail closed without a sales pitch: a 402 here would show the paywall
      // to a Pro user during a database hiccup.
      return NextResponse.json(
        { error: 'Could not check your generation allowance. Please try again.' },
        { status: 503 }
      );
    }
    if (kind === 'blocked') {
      return NextResponse.json(
        {
          error:
            "You've used your free generation. Go Pro for unlimited generations, or buy just this one.",
          upgradeRequired: true,
          reason: 'generate_quota',
          offers: ['pro', 'single'],
        },
        { status: 402 }
      );
    }
    captureServerEventAfterResponse(user.id, AnalyticsEvents.GENERATE_ALLOWANCE_USED, {
      kind,
      is_continuation: !!(documentId && currentLatex),
    });
    // At most one refund per request: `refund_generation('credit')` is an
    // unbounded +1, so a second call (an error path that runs after the
    // truncation path already refunded) would mint a credit.
    // `refunded` is set once the refund decision is made, whether or not
    // the cap below allowed it.
    let refunded = false;
    const callRefund = async () => {
      try {
        const { error: refundError } = await createAdminClient().rpc('refund_generation', {
          p_user_id: user.id,
          p_kind: kind,
        });
        if (refundError) {
          console.error('refund_generation failed:', refundError);
          return false;
        }
        return true;
      } catch (refundError) {
        console.error('refund_generation failed:', refundError);
        return false;
      }
    };
    const refundIfUnused = async (producedOutput: boolean) => {
      if (kind === 'pro' || producedOutput || refunded) return;
      refunded = true;
      await callRefund();
    };
    /**
     * A cut-off document (max_tokens or the deadline) is refunded at most
     * TRUNCATION_REFUNDS_PER_DAY times per user per rolling 24 hours, so a
     * free user cannot loop over-long requests for free. The cut-off is
     * recorded first and the count taken after (this one included):
     * concurrent cut-offs can only see more rows, never fewer, so a burst
     * cannot slip past the cap. Fails closed: if the ledger cannot be
     * written or read, there is no refund. Returns whether it refunded.
     */
    const refundTruncation = async (): Promise<boolean> => {
      if (kind === 'pro' || refunded) return false;
      refunded = true;
      try {
        // generation_truncations is newer than database.types.ts.
        const admin = createAdminClient() as any;
        const { error: insertError } = await admin
          .from('generation_truncations')
          .insert({ user_id: user.id, kind });
        if (insertError) {
          console.error('generation_truncations insert failed:', insertError);
          return false;
        }
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count, error: countError } = await admin
          .from('generation_truncations')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('created_at', since);
        if (countError || typeof count !== 'number') {
          console.error('generation_truncations count failed:', countError);
          return false;
        }
        if (count > TRUNCATION_REFUNDS_PER_DAY) return false;
      } catch (ledgerError) {
        console.error('generation_truncations failed:', ledgerError);
        return false;
      }
      return callRefund();
    };

    const isContinuation = !!(documentId && currentLatex);
    const sessionId = documentId || crypto.randomUUID();

    let systemPrompt: string;
    let userContent: string;

    if (isContinuation) {
      systemPrompt = CONTINUATION_PROMPT;

      const contextParts: string[] = [];
      contextParts.push(`CURRENT DOCUMENT:\n\`\`\`latex\n${currentLatex}\n\`\`\``);

      if (conversationSummary) {
        contextParts.push(`\nCONVERSATION CONTEXT:\n- Original intent: ${conversationSummary.original_intent}\n- Modifications made: ${conversationSummary.modifications_made.join(', ') || 'None yet'}\n- Current state: ${conversationSummary.current_state}`);
      }

      if (lastUserPrompt && lastAssistantResponse) {
        contextParts.push(`\nLAST EXCHANGE:\nUser asked: ${lastUserPrompt}\nResult: Document was updated accordingly.`);
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
    const upstream = new AbortController();
    let clientGone = false;
    const stream = new ReadableStream({
      async start(controller) {
        // The browser can go away mid-stream (Stop, closed tab); enqueue on a
        // cancelled stream throws, and that must not turn into a second
        // error path.
        const write = (event: string, data: unknown) => {
          if (clientGone) return;
          const payload = JSON.stringify(data);
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${payload}\n\n`)
            );
          } catch {
            clientGone = true;
          }
        };
        const close = () => {
          try {
            controller.close();
          } catch {
            // already closed or cancelled
          }
        };

        let producedOutput = false;
        let timedOut = false;
        const deadline = setTimeout(() => {
          timedOut = true;
          upstream.abort();
        }, GENERATE_DEADLINE_MS);

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
              model: 'claude-sonnet-4-6',
              max_tokens: GENERATE_MAX_OUTPUT_TOKENS,
              system: systemPrompt,
              messages: [{ role: 'user', content: messageContent }],
              stream: true,
            }),
            signal: upstream.signal,
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
          let stopReason: string | null = null;
          let outputTokens: number | null = null;
          let providerError: string | null = null;

          while (true) {
            let chunk: ReadableStreamReadResult<Uint8Array>;
            try {
              chunk = await reader.read();
            } catch (readError) {
              // The deadline aborted the upstream request: finish with what
              // arrived and report it as cut short, not as a crash. Same
              // when the browser left (handled after the loop).
              if (timedOut || clientGone) break;
              throw readError;
            }
            const { done, value } = chunk;
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
                  producedOutput = true;
                  accumulatedContent += event.delta.text;
                  chunkBuffer += event.delta.text;

                  if (chunkBuffer.length >= CHUNK_SIZE) {
                    write('content', { text: chunkBuffer, partial: true });
                    chunkBuffer = '';
                    if (clientGone) upstream.abort();
                  }
                } else if (event.type === 'error') {
                  // Anthropic reports mid-stream failures (overloaded_error,
                  // api_error) as an SSE error event, then ends the stream.
                  providerError = event.error?.type || 'error';
                } else if (event.type === 'message_delta') {
                  stopReason = event.delta?.stop_reason ?? stopReason;
                  if (typeof event.usage?.output_tokens === 'number') {
                    outputTokens = event.usage.output_tokens;
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

          if (clientGone) {
            // Stopped by the user after output arrived: no refund, nobody to
            // tell. (Before any output, the catch below hands it back.)
            if (!producedOutput) await refundIfUnused(false);
            return;
          }

          if (providerError) {
            // The provider failed mid-document: not the user's doing, and
            // they have no document, so the generation is handed back.
            console.error('generate-document: provider stream error:', providerError);
            await refundIfUnused(false);
            write('error', {
              message: UPSTREAM_MESSAGE,
              code: 'upstream',
              stop_reason: stopReason,
              output_tokens: outputTokens,
            });
            close();
            return;
          }

          write('status', { phase: 'finalizing', message: 'Finalizing document...' });

          const end = classifyGenerationEnd({
            content: accumulatedContent,
            stopReason,
            timedOut,
          });

          if (end.kind === 'truncated') {
            // The user asked for a document and got a fragment through no
            // fault of theirs: hand the free generation / credit back, up
            // to the daily cap. The message is the same either way.
            const truncationRefunded = await refundTruncation();
            write('error', {
              message: TRUNCATED_MESSAGE,
              code: 'truncated',
              refunded: truncationRefunded,
              stop_reason: timedOut ? 'deadline' : stopReason,
              output_tokens: outputTokens,
            });
            close();
            return;
          }

          if (end.kind === 'invalid') {
            write('error', {
              message: 'Failed to generate valid LaTeX document',
              code: 'invalid',
              stop_reason: stopReason,
              output_tokens: outputTokens,
            });
            close();
            return;
          }

          const latex = end.latex;

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
            stop_reason: stopReason,
            output_tokens: outputTokens,
          });

          close();
        } catch (err) {
          // The raw provider error (status + JSON body) goes to the logs, not
          // to the user.
          console.error('generate-document: model call failed:', err);
          // Nothing came back from the model: the user did not get a
          // generation, so they keep their free one / credit.
          await refundIfUnused(producedOutput);
          write('error', { message: UPSTREAM_MESSAGE, code: 'upstream' });
          close();
        } finally {
          clearTimeout(deadline);
          // Stop the model on every exit path (finished, failed, or the
          // browser left), so nobody pays for tokens no one will read.
          upstream.abort();
        }
      },
      cancel() {
        clientGone = true;
        upstream.abort();
      },
    });

    return new Response(stream, { headers: createSSEHeaders() });
  } catch (error) {
    captureServerExceptionAfterResponse(error, { route: 'api/generate-document' });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to process request', details: message },
      { status: 500 }
    );
  }
}

// The server client's generated Functions type does not resolve for the
// new RPCs (same reason track-edit casts increment_edit_count's args).
type SupabaseRpcClient = {
  rpc: (fn: any, args?: any) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Who pays for this generation. Whitelisted accounts (lib/paywall.ts) count
 * as Pro without touching the database; everyone else goes through
 * `consume_generation`, whose answer is one of pro | free | credit | blocked.
 * An RPC failure or an answer this code does not know is `error`: the gate
 * fails closed (503, retry) rather than open (a free unlimited generate) or
 * into the paywall (a 402 would upsell a Pro user over a database hiccup).
 */
async function consumeGeneration(
  supabase: SupabaseRpcClient,
  user: { id: string; email?: string | null }
): Promise<GenerationKind | 'blocked' | 'error'> {
  if (hasUnlimitedEdits(user.email)) return 'pro';

  const { data, error } = await supabase.rpc('consume_generation', { p_user_id: user.id });
  if (error) {
    console.error('consume_generation failed:', error);
    return 'error';
  }
  if (data === 'pro' || data === 'free' || data === 'credit' || data === 'blocked') return data;
  console.error('consume_generation returned an unknown answer:', data);
  return 'error';
}

function extractTitle(latex: string): string | null {
  const titleMatch = latex.match(/\\title\{([^}]+)\}/);
  if (titleMatch) {
    return titleMatch[1].replace(/\\\\/g, ' ').trim();
  }
  return null;
}
