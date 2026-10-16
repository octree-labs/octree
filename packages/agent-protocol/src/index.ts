/**
 * Wire contract between the web app and the agent server (apps/agent).
 * Types only — import with `import type` so nothing loads this package at runtime.
 */

/** String-matching edit (old_string/new_string), proposed by the agent and applied in the editor */
export interface StringEdit {
  file_path: string;
  old_string: string;
  new_string: string;
  explanation?: string;
}

export interface ProjectFileContext {
  path: string;
  content: string;
}

export interface SelectionRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** POST /agent request body */
export interface AgentRequest {
  messages: { role: 'user' | 'assistant'; content: string }[];
  fileContent: string;
  textFromEditor?: string | null;
  selectionRange?: SelectionRange | null;
  projectFiles?: ProjectFileContext[];
  currentFilePath?: string | null;
  sessionId?: string;
}
