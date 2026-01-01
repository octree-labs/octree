// @ts-expect-error - express types are provided at runtime on the server deployment
import express from 'express';
// @ts-expect-error - cors types are provided at runtime on the server deployment
import cors from 'cors';
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import {
  validateApiKeys, buildNumberedContent, buildSystemPrompt,
  inferIntent, createOctraTools, createMCPServerConfig,
  processStreamMessages,
} from './lib/octra-agent';
import type { ProjectFileContext } from './lib/octra-agent';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/agent', async (req: any, res: any) => {
  try {
    const keyValidation = validateApiKeys();
    if (!keyValidation.isValid) return res.status(503).json({ error: keyValidation.error });

    const {
      messages,
      fileContent,
      textFromEditor,
      selectionRange,
      projectFiles: projectFilesPayload,
      currentFilePath,
    } = req.body || {};
    if (!messages?.length || typeof fileContent !== 'string') return res.status(400).json({ error: 'Invalid request' });

    // Non-blocking operations to avoid blocking the event loop
    const numbered = await buildNumberedContent(fileContent, textFromEditor);
    const userText = typeof messages[messages.length - 1]?.content === 'string' ? messages[messages.length - 1].content : '';
    const intent = await inferIntent(userText);
    const collectedEdits: unknown[] = [];

    // Binary file extensions to exclude (PDFs, images, etc.)
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
            // Filter out binary files by extension
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

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const writeEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const tools = createOctraTools({
      fileContent,
      numberedContent: numbered,
      textFromEditor,
      selectionRange,
      collectedEdits: collectedEdits as any,
      intent,
      writeEvent,
      projectFiles,
      currentFilePath: normalizedCurrentFilePath,
    } as any);
    const sdkServer = createSdkMcpServer(createMCPServerConfig(tools) as any);
    const fullPrompt = `${buildSystemPrompt(
      numbered,
      textFromEditor,
      selectionRange,
      projectFiles,
      normalizedCurrentFilePath
    )}\n\nUser request:\n${userText}`;

    const gen = query({
      prompt: fullPrompt,
      options: {
        includePartialMessages: true,
        permissionMode: 'bypassPermissions',
        allowedTools: ['get_context', 'propose_edits'],
        mcpServers: { 'octra-tools': sdkServer },
        model: 'claude-haiku-4-5-20251001',
      },
    });

    writeEvent('status', { state: 'started' });
    
    // Use processStreamMessages to convert SDK events to chat-compatible events
    const finalText = await processStreamMessages(gen as AsyncIterable<any>, writeEvent, collectedEdits);
    
    writeEvent('done', { text: finalText, edits: collectedEdits });
    res.end();
  } catch (e: any) {
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: e?.message || 'internal error' })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`Agent service listening on :${PORT}`));
