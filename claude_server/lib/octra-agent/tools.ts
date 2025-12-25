/**
 * Tool definitions for the Octra Agent SDK
 * Defines the tools available to the AI agent for LaTeX document editing
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { LineEdit, validateLineEdits } from './line-edits';
import { IntentResult } from './intent-inference';
import { ProjectFileContext } from './content-processing';

export interface ToolContext {
  fileContent: string;
  numberedContent: string;
  textFromEditor?: string | null;
  selectionRange?: { startLineNumber: number; endLineNumber: number } | null;
  collectedEdits: LineEdit[];
  intent: IntentResult;
  writeEvent: (event: string, data: unknown) => void;
  projectFiles?: ProjectFileContext[];
  currentFilePath?: string | null;
}

/**
 * Create the get_context tool for retrieving file information
 * @param context - Tool context with file data and event writer
 * @returns Configured tool instance
 */
export function createGetContextTool(context: ToolContext) {
  return tool(
    'get_context',
    'Retrieve the current LaTeX file context with numbered lines and optional user selection.',
    {
      includeNumbered: z.boolean().optional().default(true),
      includeSelection: z.boolean().optional().default(true),
    },
    async (args) => {
      const payload: Record<string, unknown> = {
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
        payload.projectFiles = context.projectFiles.map((file) => ({
          path: file.path,
          content: file.content,
          lineCount: file.content.split('\n').length,
          isCurrent: context.currentFilePath ? context.currentFilePath === file.path : false,
        }));
      }
      if (context.currentFilePath) {
        payload.currentFilePath = context.currentFilePath;
      }
      context.writeEvent('tool', { name: 'get_context' });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload),
          },
        ],
      };
    }
  );
}

/**
 * Create the propose_edits tool for suggesting line-based edits
 * @param context - Tool context with file data, intent, and event writer
 * @returns Configured tool instance
 */
export function createProposeEditsTool(context: ToolContext) {
  return tool(
    'propose_edits',
    'Propose JSON-structured line-based edits to the LaTeX document. Each edit specifies a line number and the operation to perform (insert, delete, or replace). For multi-file projects, specify targetFile to indicate which file the edit applies to.',
    {
      edits: z
        .array(
          z.object({
            editType: z.enum(['insert', 'delete', 'replace']),
            content: z.string().optional(), // New content (for insert/replace)
            position: z.object({
              line: z.number().int().min(1), // Line number (1-indexed)
            }),
            originalLineCount: z.number().int().min(0).optional(), // How many lines to affect (for delete/replace)
            explanation: z.string().optional(), // Human-readable explanation of the edit
            targetFile: z.string().optional(), // Path of the file this edit targets
          })
        )
        .min(1),
    },
    async (args) => {
      const validation = validateLineEdits(args.edits, context.intent, context.fileContent);
      
      // Assign targetFile to each edit (use provided value or fallback to currentFilePath)
      const editsWithTargetFile = validation.acceptedEdits.map((edit) => ({
        ...edit,
        targetFile: edit.targetFile || context.currentFilePath || undefined,
      }));
      
      // Add accepted edits to the collection
      context.collectedEdits.push(...editsWithTargetFile);
      
      const totalEdits = editsWithTargetFile.length;

      context.writeEvent('tool', {
        name: 'propose_edits',
        count: totalEdits,
        violations: validation.violations,
      });

      if (totalEdits > 0) {
        editsWithTargetFile.forEach((edit) => {
          context.writeEvent('tool', {
            name: 'propose_edits',
            progress: 1,
          });
        });

        // Emit the full batch of edits once all progress events are dispatched
        context.writeEvent('edits', editsWithTargetFile);
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Accepted ${editsWithTargetFile.length} edit(s). ${validation.violations.length ? 'Blocked ' + validation.violations.length + ' edit(s) due to intent restrictions.' : ''}`,
          },
        ],
      };
    }
  );
}

/**
 * Create all tools for the Octra Agent SDK
 * @param context - Tool context with all necessary data
 * @returns Array of configured tool instances
 */
export function createOctraTools(context: ToolContext) {
  return [
    createGetContextTool(context),
    createProposeEditsTool(context),
  ];
}
