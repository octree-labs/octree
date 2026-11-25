import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { streamText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

import {
  validateApiKeys,
  buildNumberedContent,
  buildSystemPrompt,
} from './lib/content-processing.js';
import type { ProjectFileContext } from './lib/content-processing.js';
import { createOctraTools } from './lib/tools.js';
import type { StringEdit } from './lib/edits.js';
import { createSSEHeaders, processFullStream } from './lib/stream-handling.js';
import { SessionManager } from './lib/session-manager.js';
import {
  ALLOWED_JWKS_ALGORITHMS,
  ALLOWED_SECRET_ALGORITHMS,
  getAgentUserClaims,
} from './lib/auth-claims.js';
import type { AgentUserClaims } from './lib/auth-claims.js';
import { PROXY_SECRET_HEADER, checkProxySecret } from './lib/proxy-secret.js';

const SUPABASE_JWT_SECRET: string = (() => {
  const s = process.env.SUPABASE_JWT_SECRET;
  if (!s) {
    console.error('[FATAL] SUPABASE_JWT_SECRET is not set. Refusing to start to prevent unauthenticated /agent access.');
    process.exit(1);
  }
  return s;
})();

// Supabase projects using asymmetric JWT signing keys (ES256/RS256, the default
// for new local stacks) can't be verified with the shared secret. When
// SUPABASE_URL is set, fall back to the project's public JWKS.
const SUPABASE_JWKS = process.env.SUPABASE_URL
  ? createRemoteJWKSet(
      new URL('/auth/v1/.well-known/jwks.json', process.env.SUPABASE_URL)
    )
  : null;

// Verifies the signature (HS256 only against the shared secret; ES256/RS256
// only against the JWKS, so no algorithm confusion) and then requires a
// signed-in user token. Throws on any failure.
async function verifySupabaseToken(token: string): Promise<AgentUserClaims> {
  let payload: unknown;
  try {
    payload = jwt.verify(token, SUPABASE_JWT_SECRET, {
      algorithms: [...ALLOWED_SECRET_ALGORITHMS],
    });
  } catch (error) {
    if (!SUPABASE_JWKS) throw error;
    ({ payload } = await jwtVerify(token, SUPABASE_JWKS, {
      algorithms: [...ALLOWED_JWKS_ALGORITHMS],
    }));
  }
  const claims = getAgentUserClaims(payload);
  if (!claims) throw new Error('Token is not a signed-in user token');
  return claims;
}

// Shared secret with the Next.js proxy, which enforces quotas and the paywall.
// Unset keeps the old JWT-only behaviour so this can deploy before the env is
// configured; set it on both sides and every non-health request must carry it.
const AGENT_SERVICE_SECRET = process.env.AGENT_SERVICE_SECRET?.trim() || undefined;
if (!AGENT_SERVICE_SECRET) {
  console.warn(
    '[SECURITY WARNING] AGENT_SERVICE_SECRET is not set: /agent accepts any signed-in user token ' +
      'without the proxy secret, bypassing usage limits. Set it here and on the Next.js app.'
  );
}

const app = express();
// Only the Next.js server calls this service; no browser origin is allowed.
app.use(cors({ origin: false }));

app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok' });
});

function proxySecretMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const result = checkProxySecret(AGENT_SERVICE_SECRET, req.headers[PROXY_SECRET_HEADER]);
  if (result === 'missing') {
    res.status(401).json({ error: 'Proxy credentials required' });
    return;
  }
  if (result === 'invalid') {
    res.status(403).json({ error: 'Invalid proxy credentials' });
    return;
  }
  next();
}

// Everything registered after this line (all routes but /health) needs the
// proxy secret when it is configured. Checked before parsing the body.
app.use(proxySecretMiddleware);
app.use(express.json({ limit: '10mb' }));

async function jwtAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Authorization header required' });
    return;
  }

  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) {
    res.status(401).json({ error: 'Invalid authorization header format' });
    return;
  }

  const token = authHeader.slice(prefix.length);

  try {
    res.locals.user = await verifySupabaseToken(token);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  next();
}

app.post('/agent', jwtAuthMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const keyValidation = validateApiKeys();
    if (!keyValidation.isValid) {
      res.status(503).json({ error: keyValidation.error });
      return;
    }

    const {
      messages,
      fileContent,
      textFromEditor,
      selectionRange,
      projectFiles: projectFilesPayload,
      currentFilePath,
      sessionId,
    } = req.body || {};

    if (!messages?.length || typeof fileContent !== 'string') {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }

    const numbered = await buildNumberedContent(fileContent, textFromEditor);
    const userText = typeof messages[messages.length - 1]?.content === 'string'
      ? messages[messages.length - 1].content
      : '';
    const collectedEdits: StringEdit[] = [];

    const binaryExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.eps', '.ps', '.dvi', '.aux', '.log', '.out', '.toc', '.lof', '.lot', '.bbl', '.blg', '.synctex', '.fls', '.fdb_latexmk', '.gz'];

    const projectFiles: ProjectFileContext[] = Array.isArray(projectFilesPayload)
      ? projectFilesPayload
        .filter(
          (file: unknown): file is { path: string; content: string } =>
            !!file &&
            typeof (file as { path?: unknown }).path === 'string' &&
            typeof (file as { content?: unknown }).content === 'string'
        )
        .filter((file) => {
          const ext = file.path.toLowerCase().substring(file.path.lastIndexOf('.'));
          return !binaryExtensions.includes(ext);
        })
        .map((file) => ({
          path: file.path,
          content: file.content,
        }))
      : [];

    const normalizedCurrentFilePath =
      typeof currentFilePath === 'string' ? currentFilePath : null;

    // Set SSE headers
    const headers = createSSEHeaders();
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }

    const writeEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Extract auth token for compile service
    const authHeader = req.headers.authorization;
    const authToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    const tools = createOctraTools({
      fileContent,
      textFromEditor,
      selectionRange,
      collectedEdits,
      writeEvent,
      projectFiles,
      currentFilePath: normalizedCurrentFilePath,
      compileServiceUrl: process.env.COMPILE_SERVICE_URL || null,
      authToken,
    });

    // Session memory is per user: a caller-chosen sessionId alone must not
    // reach another user's conversation summary.
    const user = res.locals.user as AgentUserClaims;
    const sessionKey =
      typeof sessionId === 'string' && sessionId ? `${user.sub}:${sessionId}` : undefined;
    const sessionManager = SessionManager.getInstance();
    const currentSession = sessionKey ? sessionManager.getSession(sessionKey) : undefined;
    const sessionSummary = currentSession?.summary || null;
    const lastInteraction = currentSession?.lastInteraction || null;

    console.log('[Session] sessionId:', sessionId || '(none)');
    console.log('[Session] hasSummary:', !!sessionSummary, 'hasLastInteraction:', !!lastInteraction);

    const systemPrompt = buildSystemPrompt(
      numbered,
      textFromEditor,
      selectionRange,
      projectFiles,
      normalizedCurrentFilePath,
      sessionSummary,
      lastInteraction
    );

    writeEvent('status', { state: 'started' });

    // Prompt caching: one breakpoint on the system prompt (tools + system are
    // identical on every step) and one on the newest message of each step, so
    // the next step reads the whole conversation so far from cache.
    const cacheControl = { anthropic: { cacheControl: { type: 'ephemeral' } } } as const;

    const result = streamText({
      model: anthropic('claude-sonnet-5-5'),
      messages: [
        { role: 'system', content: systemPrompt, providerOptions: cacheControl },
        { role: 'user', content: userText },
      ],
      prepareStep: ({ messages }) => ({
        messages: messages.map((message, i) =>
          i === messages.length - 1 ? { ...message, providerOptions: cacheControl } : message
        ),
      }),
      tools,
      stopWhen: stepCountIs(25),
      // Thinking counts toward this limit, so leave room beyond the reply itself.
      maxOutputTokens: 64000,
      providerOptions: {
        anthropic: { effort: 'medium' },
      },
    });

    const finalText = await processFullStream(result.fullStream, writeEvent, collectedEdits);

    if (sessionKey) {
      sessionManager.storeLastInteraction(sessionKey, userText, finalText);
      console.log('[Session] Generating updated summary for:', sessionId);
      sessionManager.generateUpdatedSummary(sessionKey, sessionSummary || '', userText, finalText).catch(console.error);
    } else {
      console.log('[Session] No sessionId provided - skipping session update');
    }

    writeEvent('done', { text: finalText, edits: collectedEdits });
    res.end();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'internal error';
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`Agent service listening on :${PORT}`));
