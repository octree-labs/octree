import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

import {
  validateApiKeys,
  buildNumberedContent,
  buildSystemPrompt,
} from './lib/content-processing.js';
import type { ProjectFileContext } from './lib/content-processing.js';
import { inferIntent } from './lib/intent-inference.js';
import { createOctraTools } from './lib/tools.js';
import type { StringEdit } from './lib/edits.js';
import { createSSEHeaders, processFullStream } from './lib/stream-handling.js';
import { SessionManager } from './lib/session-manager.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

function jwtAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) {
    next();
    return;
  }

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
    jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
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
    const intent = await inferIntent(userText);
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
      numberedContent: numbered,
      textFromEditor,
      selectionRange,
      collectedEdits,
      intent,
      writeEvent,
      projectFiles,
      currentFilePath: normalizedCurrentFilePath,
      compileServiceUrl: process.env.COMPILE_SERVICE_URL || null,
      authToken,
    });

    const sessionManager = SessionManager.getInstance();
    const currentSession = sessionId ? sessionManager.getSession(sessionId) : undefined;
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

    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: systemPrompt,
      prompt: userText,
      tools,
      maxSteps: 25,
      maxTokens: 16384,
    });

    const finalText = await processFullStream(result.fullStream, writeEvent, collectedEdits);

    if (sessionId) {
      sessionManager.storeLastInteraction(sessionId, userText, finalText);
      console.log('[Session] Generating updated summary for:', sessionId);
      sessionManager.generateUpdatedSummary(sessionId, sessionSummary || '', userText, finalText).catch(console.error);
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
