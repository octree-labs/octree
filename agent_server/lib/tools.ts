/**
 * Vercel AI SDK tool definitions for the Octra Agent
 */

import { tool } from 'ai';
import { z } from 'zod';
import { StringEdit, validateStringEdit, inferEditType } from './edits.js';
import { IntentResult } from './intent-inference.js';
import { ProjectFileContext } from './content-processing.js';

export interface ToolContext {
  fileContent: string;
  numberedContent: string;
  textFromEditor?: string | null;
  selectionRange?: { startLineNumber: number; endLineNumber: number } | null;
  collectedEdits: StringEdit[];
  intent: IntentResult;
  writeEvent: (event: string, data: unknown) => void;
  projectFiles?: ProjectFileContext[];
  currentFilePath?: string | null;
  compileServiceUrl?: string | null;
  authToken?: string | null;
}

/**
 * Create all tools for the Vercel AI SDK agent
 */
export function createOctraTools(context: ToolContext) {
  return {
    get_context: tool({
      description: 'Retrieve file context with numbered lines. Use filePath to fetch a specific project file, or omit to get the currently open file.',
      parameters: z.object({
        filePath: z.string().optional().describe('Specific file to fetch (omit for current file)'),
        includeNumbered: z.boolean().optional().default(true),
        includeSelection: z.boolean().optional().default(true),
      }),
      execute: async (args) => {
        const filePath = args.filePath;
        if (filePath && context.projectFiles?.length) {
          const requestedFile = context.projectFiles.find(
            f => f.path === filePath ||
              f.path.endsWith(filePath) ||
              f.path.endsWith(`/${filePath}`)
          );

          if (requestedFile) {
            const lines = requestedFile.content.split('\n');
            const numberedContent = lines.map((line, idx) => `${idx + 1}: ${line}`).join('\n');

            context.writeEvent('tool', { name: 'get_context', file: requestedFile.path });
            return JSON.stringify({
              filePath: requestedFile.path,
              lineCount: lines.length,
              numberedContent,
            });
          } else {
            context.writeEvent('tool', { name: 'get_context', error: 'file_not_found' });
            return JSON.stringify({ error: `File not found: ${filePath}` });
          }
        }

        // Default: return current file context
        const payload: Record<string, unknown> = {
          currentFilePath: context.currentFilePath,
          lineCount: context.fileContent.split('\n').length,
        };
        if (args.includeNumbered !== false) {
          payload.numberedContent = context.numberedContent;
        }
        if (args.includeSelection !== false && context.textFromEditor) {
          payload.selection = context.textFromEditor;
        }
        if (context.selectionRange) {
          payload.selectionRange = context.selectionRange;
        }
        if (context.projectFiles?.length) {
          payload.availableFiles = context.projectFiles.map((file) => ({
            path: file.path,
            lineCount: file.content.split('\n').length,
            isCurrent: context.currentFilePath ? context.currentFilePath === file.path : false,
          }));
        }
        context.writeEvent('tool', { name: 'get_context' });
        return JSON.stringify(payload);
      },
    }),

    edit: tool({
      description: 'Edit a LaTeX file using exact string matching. Specify old_string (text to find) and new_string (replacement). old_string must match exactly one location. Use empty old_string to append to end of file.',
      parameters: z.object({
        file_path: z.string().describe('Path of the file to edit'),
        old_string: z.string().describe('Exact text to find and replace (empty string to append)'),
        new_string: z.string().describe('Replacement text (empty string to delete)'),
        explanation: z.string().optional().describe('Brief explanation of the edit'),
      }),
      execute: async (args) => {
        const edit: StringEdit = {
          file_path: args.file_path || context.currentFilePath || '',
          old_string: args.old_string,
          new_string: args.new_string,
          explanation: args.explanation,
        };

        const editType = inferEditType(edit);

        // Resolve file content for validation
        let targetContent = context.fileContent;
        if (edit.file_path && edit.file_path !== context.currentFilePath) {
          const targetFile = context.projectFiles?.find(
            f => f.path === edit.file_path ||
              f.path.endsWith(edit.file_path) ||
              f.path.endsWith(`/${edit.file_path}`)
          );
          if (targetFile) {
            targetContent = targetFile.content;
            // Normalize file_path to the canonical path
            edit.file_path = targetFile.path;
          }
        }

        // Validate uniqueness
        const validation = validateStringEdit(edit, targetContent);
        if (!validation.valid) {
          context.writeEvent('tool', { name: 'edit', error: validation.error });
          return `Edit validation failed: ${validation.error}`;
        }

        // Collect the edit
        context.collectedEdits.push(edit);

        // Emit events
        context.writeEvent('tool', {
          name: 'edit',
          count: context.collectedEdits.length,
          progress: 1,
        });
        context.writeEvent('edits', [edit]);

        return `Edit accepted: ${editType} in ${edit.file_path}`;
      },
    }),

    compile: tool({
      description: 'Compile the LaTeX project to check for errors. Returns compilation log. Use after making edits to verify they compile correctly. If there are errors, read the log, fix the issues with the edit tool, and compile again.',
      parameters: z.object({}),
      execute: async () => {
        if (!context.compileServiceUrl) {
          return JSON.stringify({ success: false, error: 'Compile service not configured' });
        }

        // Apply collected edits to get current file contents
        const currentPath = context.currentFilePath || 'main.tex';
        const fileContents = new Map<string, string>();

        // Start with original contents
        fileContents.set(currentPath, context.fileContent);
        for (const file of context.projectFiles || []) {
          if (file.path !== currentPath) {
            fileContents.set(file.path, file.content);
          }
        }

        // Apply all collected edits
        for (const edit of context.collectedEdits) {
          const targetPath = edit.file_path || currentPath;
          const content = fileContents.get(targetPath);
          if (content === undefined) continue;

          if (edit.old_string === '') {
            fileContents.set(targetPath, content + edit.new_string);
          } else {
            const idx = content.indexOf(edit.old_string);
            if (idx !== -1) {
              fileContents.set(
                targetPath,
                content.slice(0, idx) + edit.new_string + content.slice(idx + edit.old_string.length)
              );
            }
          }
        }

        // Build files payload
        const files = Array.from(fileContents.entries()).map(([path, content]) => ({
          path,
          content,
        }));

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 120_000);

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (context.authToken) {
            headers['Authorization'] = `Bearer ${context.authToken}`;
          }

          const response = await fetch(`${context.compileServiceUrl}/compile`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ files, lastModifiedFile: currentPath }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            context.writeEvent('tool', { name: 'compile_success' });
            return JSON.stringify({ success: true, message: 'Compilation succeeded with no errors.' });
          }

          const errorText = await response.text();
          let errorData: Record<string, unknown>;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText };
          }

          // Extract the most useful parts of the log
          const log = (errorData.log as string) || '';
          const stderr = (errorData.stderr as string) || '';
          const errorLines = log
            .split('\n')
            .filter((line: string) => /^!|^l\.\d|LaTeX Error|Undefined control sequence|Missing|Extra/.test(line))
            .slice(0, 30)
            .join('\n');

          context.writeEvent('tool', { name: 'compile', success: false });

          return JSON.stringify({
            success: false,
            error: (errorData.error as string) || 'Compilation failed',
            errorLines: errorLines || undefined,
            log: log.length > 3000 ? log.slice(-3000) : log,
            stderr: stderr.length > 1000 ? stderr.slice(-1000) : stderr,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          context.writeEvent('tool', { name: 'compile', success: false, error: msg });
          return JSON.stringify({ success: false, error: `Compile request failed: ${msg}` });
        }
      },
    }),
  };
}
