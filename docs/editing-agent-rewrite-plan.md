# Editing Agent Rewrite Plan

A comprehensive plan for rebuilding the Octra editing agent with AI SDK, addressing learnings from front-end file management, multi-file editing, context management, and compression challenges.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Core Design Decisions](#2-core-design-decisions)
3. [Tool Schema Redesign](#3-tool-schema-redesign)
4. [Frontend Refactor](#4-frontend-refactor)
5. [Backend API Design](#5-backend-api-design)
6. [Multi-File Editing Strategy](#6-multi-file-editing-strategy)
7. [Context Compression](#7-context-compression)
8. [Error Handling & Recovery](#8-error-handling--recovery)
9. [Migration Strategy](#9-migration-strategy)
10. [Benefits Summary](#10-benefits-summary)

---

## 1. Architecture Overview

### Current Pain Points

| Problem | Description |
|---------|-------------|
| **Front-end file management** | Manual state synchronization between Monaco editor, Zustand file store, and agent-generated edits |
| **Multi-file editing** | `targetFile` tracking on edits, separate handling for "current file" vs "other files" |
| **Context management** | Document truncation (100 lines head/tail), project file expansion, selection regions |
| **Compression** | Line numbering adds token overhead, redundant content in project files |
| **Edit rebasing** | Complex logic for adjusting line numbers after edits are applied |

### Proposed Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                          │
├────────────────────┬─────────────────────┬───────────────────────┤
│  useAgentSession   │  useProjectFiles    │  useEditQueue         │
│  (AI SDK useChat)  │  (File State)       │  (Optimistic Edits)   │
└────────┬───────────┴─────────┬───────────┴──────────┬────────────┘
         │                     │                      │
         ▼                     ▼                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Unified Editor Context                         │
│   - Virtual Document (canonical state)                           │
│   - Pending Edits Queue                                          │
│   - File Snapshots (for agent context)                           │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                        API Layer (Next.js)                        │
│  /api/agent/chat  ─────────►  AI SDK streamText                  │
│  - Context Compiler (smart compression)                          │
│  - Edit Validator (pre-apply checks)                             │
│  - Response Parser (structured outputs)                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Design Decisions

### 2.1 Move from SSE to AI SDK's `useChat` + Data Stream Protocol

**Why**: Current implementation manually parses SSE events (`assistant_partial`, `edits`, `tool`, etc.). AI SDK's built-in protocol handles this automatically.

```typescript
// NEW: Frontend hook
import { useChat } from 'ai/react';

export function useAgentSession() {
  const chat = useChat({
    api: '/api/agent/chat',
    streamProtocol: 'data', // Uses AI SDK data stream protocol
    onToolCall: async ({ toolCall }) => {
      // Handle tool calls client-side if needed
      return handleToolCall(toolCall);
    },
  });

  return {
    ...chat,
    pendingEdits: useMemo(() => 
      extractEditsFromMessages(chat.messages),
      [chat.messages]
    ),
  };
}
```

### 2.2 Replace Line-Based Edits with Search/Replace Operations

**Why**: Line numbers are fragile. They shift during edits and require expensive rebasing logic.

```typescript
// OLD: Line-based
interface LineEdit {
  editType: 'insert' | 'delete' | 'replace';
  position: { line: number };
  originalLineCount?: number;
  content?: string;
}

// NEW: Search/Replace with anchors
interface StructuredEdit {
  id: string;
  targetFile: string;
  operation: EditOperation;
  explanation?: string;
}

type EditOperation = 
  | { type: 'replace'; search: string; replace: string }
  | { type: 'insert_after'; anchor: string; content: string }
  | { type: 'insert_before'; anchor: string; content: string }
  | { type: 'delete'; search: string }
  | { type: 'append'; content: string }
  | { type: 'prepend'; content: string };
```

**Benefits**:
- No line number calculations
- Survives concurrent edits without rebasing
- Search anchors are more robust (multi-line context)
- Matches how humans describe edits ("replace X with Y", "add after the imports")

### 2.3 Virtual Document with Optimistic Updates

**Why**: Current approach mutates editor content and file store separately, causing sync issues.

```typescript
// NEW: Unified document state
interface VirtualDocument {
  path: string;
  baseContent: string;           // Last saved/confirmed content
  pendingEdits: StructuredEdit[]; // Edits waiting for confirmation
  optimisticContent: string;      // baseContent + applied pending edits
  version: number;                // For conflict detection
}

// Store manages the canonical state
const useDocumentStore = create<{
  documents: Map<string, VirtualDocument>;
  applyEdit: (edit: StructuredEdit) => void;
  confirmEdit: (editId: string) => void;
  rejectEdit: (editId: string) => void;
  revertToBase: (path: string) => void;
}>();
```

### 2.4 Smart Context Compression

**Why**: Current approach truncates to 100+100 lines, losing context. New approach uses semantic compression.

```typescript
interface ContextCompiler {
  // Compiles files into minimal context for the agent
  compile(files: ProjectFile[], options: CompileOptions): CompiledContext;
}

interface CompileOptions {
  currentFile: string;           // Full content for main file
  maxTokens: number;             // Target context size
  focusRegion?: Selection;       // Expand context around selection
  referencedFiles?: string[];    // Files mentioned in conversation
}

interface CompiledContext {
  primaryDocument: string;        // Full numbered content
  projectSummary: string;         // Compact representation
  expandedFiles: FileContext[];   // Full content for referenced files
  tokenCount: number;
}
```

---

## 3. Tool Schema Redesign

### 3.1 Unified Edit Tool

```typescript
const editDocumentTool = tool({
  description: `Apply edits to project files. Use search/replace for precise modifications.`,
  
  parameters: z.object({
    edits: z.array(z.object({
      targetFile: z.string().describe('File path to edit'),
      
      operation: z.discriminatedUnion('type', [
        z.object({
          type: z.literal('replace'),
          search: z.string().describe('Exact text to find (include enough context to be unique)'),
          replace: z.string().describe('Replacement text'),
        }),
        z.object({
          type: z.literal('insert_after'),
          anchor: z.string().describe('Text to insert after (must be unique)'),
          content: z.string().describe('Content to insert'),
        }),
        z.object({
          type: z.literal('insert_before'),
          anchor: z.string().describe('Text to insert before (must be unique)'),
          content: z.string().describe('Content to insert'),
        }),
        z.object({
          type: z.literal('delete'),
          search: z.string().describe('Text to delete'),
        }),
      ]),
      
      explanation: z.string().optional().describe('Brief explanation of the change'),
    })),
  }),

  execute: async ({ edits }, { context }) => {
    const results = await applyEdits(edits, context);
    return formatEditResults(results);
  },
});
```

### 3.2 Read Context Tool (for multi-file awareness)

```typescript
const getContextTool = tool({
  description: 'Get content from other project files when you need to reference them.',
  
  parameters: z.object({
    files: z.array(z.string()).describe('File paths to read'),
    sections: z.array(z.object({
      file: z.string(),
      startMarker: z.string().optional(),
      endMarker: z.string().optional(),
    })).optional().describe('Specific sections to read'),
  }),

  execute: async ({ files, sections }, { context }) => {
    return getFileContents(files, sections, context.projectFiles);
  },
});
```

### 3.3 Validate Tool (for LaTeX compilation)

```typescript
const validateDocumentTool = tool({
  description: 'Compile the document to check for errors. Call this after making changes.',
  
  parameters: z.object({
    includeEdits: z.boolean().default(true).describe('Include pending edits in compilation'),
  }),

  execute: async ({ includeEdits }, { context }) => {
    const content = includeEdits 
      ? context.getOptimisticContent() 
      : context.getBaseContent();
    return await compileLatex(content);
  },
});
```

---

## 4. Frontend Refactor

### 4.1 New Hook Structure

```typescript
// hooks/use-agent/index.ts
export function useAgent(projectId: string) {
  // 1. AI SDK chat integration
  const chat = useChat({
    api: '/api/agent/chat',
    body: { projectId },
    streamProtocol: 'data',
  });

  // 2. Edit extraction from streamed data
  const { edits, applyEdit, rejectEdit } = useEditExtractor(chat.data);

  // 3. Document sync with editor
  const { syncToEditor, syncFromEditor } = useEditorSync(edits);

  return {
    // Chat interface
    messages: chat.messages,
    input: chat.input,
    handleInputChange: chat.handleInputChange,
    submit: chat.handleSubmit,
    isLoading: chat.isLoading,
    stop: chat.stop,

    // Edit management
    pendingEdits: edits.filter(e => e.status === 'pending'),
    acceptEdit: (id: string) => { applyEdit(id); syncToEditor(id); },
    acceptAllEdits: () => edits.forEach(e => { applyEdit(e.id); syncToEditor(e.id); }),
    rejectEdit,

    // Editor sync
    syncFromEditor,
  };
}
```

### 4.2 Simplified Edit Application

```typescript
// lib/edit-engine.ts
export function applySearchReplace(
  content: string,
  operation: EditOperation
): { success: boolean; content: string; error?: string } {
  switch (operation.type) {
    case 'replace': {
      const index = content.indexOf(operation.search);
      if (index === -1) {
        return { 
          success: false, 
          content, 
          error: `Could not find: "${operation.search.slice(0, 50)}..."` 
        };
      }
      const newContent = 
        content.slice(0, index) + 
        operation.replace + 
        content.slice(index + operation.search.length);
      return { success: true, content: newContent };
    }
    
    case 'insert_after': {
      const index = content.indexOf(operation.anchor);
      if (index === -1) {
        return { 
          success: false, 
          content, 
          error: `Could not find anchor: "${operation.anchor.slice(0, 50)}..."` 
        };
      }
      const insertPoint = index + operation.anchor.length;
      const newContent = 
        content.slice(0, insertPoint) + 
        operation.content + 
        content.slice(insertPoint);
      return { success: true, content: newContent };
    }
    
    case 'insert_before': {
      const index = content.indexOf(operation.anchor);
      if (index === -1) {
        return { 
          success: false, 
          content, 
          error: `Could not find anchor: "${operation.anchor.slice(0, 50)}..."` 
        };
      }
      const newContent = 
        content.slice(0, index) + 
        operation.content + 
        content.slice(index);
      return { success: true, content: newContent };
    }
    
    case 'delete': {
      const index = content.indexOf(operation.search);
      if (index === -1) {
        return { 
          success: false, 
          content, 
          error: `Could not find text to delete: "${operation.search.slice(0, 50)}..."` 
        };
      }
      const newContent = 
        content.slice(0, index) + 
        content.slice(index + operation.search.length);
      return { success: true, content: newContent };
    }
    
    case 'append': {
      return { success: true, content: content + operation.content };
    }
    
    case 'prepend': {
      return { success: true, content: operation.content + content };
    }
    
    default:
      return { success: false, content, error: 'Unknown operation type' };
  }
}
```

### 4.3 Decoration Engine (Monaco)

```typescript
// hooks/use-edit-decorations.ts
export function useEditDecorations(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  edits: StructuredEdit[],
  documentContent: string
) {
  useEffect(() => {
    if (!editor) return;

    const decorations = edits.flatMap(edit => {
      // Find the range in current document
      const range = findEditRange(documentContent, edit.operation);
      if (!range) return [];

      return [{
        range,
        options: {
          className: 'edit-highlight-pending',
          glyphMarginClassName: 'edit-glyph',
          hoverMessage: { value: edit.explanation || 'Pending edit' },
        },
      }];
    });

    const ids = editor.deltaDecorations([], decorations);
    return () => { editor.deltaDecorations(ids, []); };
  }, [editor, edits, documentContent]);
}

// Helper to find where an edit would apply
function findEditRange(
  content: string, 
  operation: EditOperation
): Monaco.IRange | null {
  const lines = content.split('\n');
  
  let searchText: string;
  switch (operation.type) {
    case 'replace':
    case 'delete':
      searchText = operation.search;
      break;
    case 'insert_after':
    case 'insert_before':
      searchText = operation.anchor;
      break;
    default:
      return null;
  }
  
  const index = content.indexOf(searchText);
  if (index === -1) return null;
  
  // Convert index to line/column
  const beforeText = content.slice(0, index);
  const startLine = beforeText.split('\n').length;
  const startColumn = beforeText.length - beforeText.lastIndexOf('\n');
  
  const endIndex = index + searchText.length;
  const beforeEndText = content.slice(0, endIndex);
  const endLine = beforeEndText.split('\n').length;
  const endColumn = beforeEndText.length - beforeEndText.lastIndexOf('\n');
  
  return {
    startLineNumber: startLine,
    startColumn,
    endLineNumber: endLine,
    endColumn,
  };
}
```

---

## 5. Backend API Design

### 5.1 API Route with AI SDK

```typescript
// app/api/agent/chat/route.ts
import { streamText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function POST(request: Request) {
  const { messages, projectId, currentFile, projectFiles } = await request.json();

  // Compile context
  const context = await compileContext({
    projectId,
    currentFile,
    projectFiles,
    conversationContext: extractReferencedFiles(messages),
  });

  // Create runtime context for tools
  const runtimeContext = createRuntimeContext(context);

  const result = streamText({
    model: openai('gpt-4o'),
    system: buildSystemPrompt(context),
    messages,
    tools: {
      edit_document: createEditTool(runtimeContext),
      get_context: createGetContextTool(runtimeContext),
      validate: createValidateTool(runtimeContext),
    },
    maxSteps: 5,
    onFinish: async ({ usage }) => {
      await trackUsage(projectId, usage);
    },
  });

  return result.toDataStreamResponse();
}
```

### 5.2 System Prompt Template

```typescript
function buildSystemPrompt(context: CompiledContext): string {
  return `You are an AI editing assistant for LaTeX documents.

## Your Tools

- **edit_document**: Apply changes using search/replace operations
- **get_context**: Read content from other project files  
- **validate**: Compile the document to check for errors

## How to Make Edits

Use search/replace with enough context to uniquely identify the target:

### Good Example
\`\`\`json
{
  "type": "replace",
  "search": "\\\\begin{document}\\n\\\\title{Old Title}",
  "replace": "\\\\begin{document}\\n\\\\title{New Title}"
}
\`\`\`

### Bad Example (not unique)
\`\`\`json
{
  "type": "replace",
  "search": "Title",
  "replace": "New Title"
}
\`\`\`

## Guidelines

1. Always include enough context in \`search\` to be unique
2. For insertions, use \`insert_after\` or \`insert_before\` with a unique anchor
3. Call \`validate\` after making edits to check for errors
4. When fixing errors, always validate first to see actual error messages

## Current File: ${context.currentFile}

\`\`\`latex
${context.primaryDocument}
\`\`\`

## Project Structure

${context.projectSummary}
`;
}
```

### 5.3 Runtime Context

```typescript
interface RuntimeContext {
  projectFiles: Map<string, string>;
  currentFile: string;
  pendingEdits: StructuredEdit[];
  
  getContent(path: string): string | null;
  getOptimisticContent(path: string): string;
  recordEdit(edit: StructuredEdit): void;
}

function createRuntimeContext(compiled: CompiledContext): RuntimeContext {
  const files = new Map<string, string>();
  const pendingEdits: StructuredEdit[] = [];
  
  // Initialize with project files
  for (const file of compiled.expandedFiles) {
    files.set(file.path, file.content);
  }

  return {
    projectFiles: files,
    currentFile: compiled.currentFile,
    pendingEdits,
    
    getContent(path: string) {
      return files.get(path) ?? null;
    },
    
    getOptimisticContent(path: string) {
      let content = files.get(path);
      if (!content) return '';
      
      // Apply pending edits for this file
      const fileEdits = pendingEdits.filter(e => e.targetFile === path);
      for (const edit of fileEdits) {
        const result = applySearchReplace(content, edit.operation);
        if (result.success) {
          content = result.content;
        }
      }
      
      return content;
    },
    
    recordEdit(edit: StructuredEdit) {
      pendingEdits.push(edit);
      
      // Also update base content for subsequent edits
      const content = files.get(edit.targetFile);
      if (content) {
        const result = applySearchReplace(content, edit.operation);
        if (result.success) {
          files.set(edit.targetFile, result.content);
        }
      }
    },
  };
}
```

---

## 6. Multi-File Editing Strategy

### 6.1 File References in Edits

```typescript
// Each edit explicitly targets a file
interface StructuredEdit {
  id: string;
  targetFile: string;  // Always required
  operation: EditOperation;
  status: 'pending' | 'applied' | 'rejected' | 'error';
}

// Group edits by file for batch application
function groupEditsByFile(edits: StructuredEdit[]): Map<string, StructuredEdit[]> {
  const groups = new Map<string, StructuredEdit[]>();
  for (const edit of edits) {
    const existing = groups.get(edit.targetFile) || [];
    groups.set(edit.targetFile, [...existing, edit]);
  }
  return groups;
}
```

### 6.2 Cross-File Operations

```typescript
// When accepting all edits, apply per-file
async function acceptAllEdits(
  edits: StructuredEdit[], 
  documents: Map<string, VirtualDocument>,
  currentEditor: Monaco.editor.IStandaloneCodeEditor | null
) {
  const byFile = groupEditsByFile(edits);

  for (const [filePath, fileEdits] of byFile) {
    const doc = documents.get(filePath);
    if (!doc) continue;

    // Apply edits in order
    let content = doc.baseContent;
    for (const edit of fileEdits) {
      const result = applySearchReplace(content, edit.operation);
      if (result.success) {
        content = result.content;
      } else {
        console.warn(`Failed to apply edit: ${result.error}`);
      }
    }

    // Update document
    documents.set(filePath, {
      ...doc,
      baseContent: content,
      pendingEdits: [],
      optimisticContent: content,
      version: doc.version + 1,
    });

    // If current file, sync to editor
    if (currentEditor && isCurrentFile(filePath)) {
      syncContentToEditor(currentEditor, content);
    }
  }
}
```

### 6.3 UI Considerations

```typescript
// Component to show edits grouped by file
function PendingEditsPanel({ edits }: { edits: StructuredEdit[] }) {
  const grouped = groupEditsByFile(edits);
  
  return (
    <div className="pending-edits">
      {Array.from(grouped.entries()).map(([file, fileEdits]) => (
        <div key={file} className="file-edits">
          <h4>{file}</h4>
          <ul>
            {fileEdits.map(edit => (
              <li key={edit.id}>
                <span className="operation">{edit.operation.type}</span>
                <span className="explanation">{edit.explanation}</span>
                <button onClick={() => acceptEdit(edit.id)}>Accept</button>
                <button onClick={() => rejectEdit(edit.id)}>Reject</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

---

## 7. Context Compression

### 7.1 Compression Strategies

```typescript
const compressionStrategies = {
  // 1. Collapse repetitive content
  collapseRepetition: (content: string) => {
    // e.g., "\\item A\n\\item B\n... [15 similar items] ...\n\\item Z"
    const lines = content.split('\n');
    const patterns = detectRepetitivePatterns(lines);
    
    for (const pattern of patterns) {
      if (pattern.count > 5) {
        const collapsed = [
          ...lines.slice(0, pattern.startIndex + 2),
          `... [${pattern.count - 4} similar ${pattern.type} items] ...`,
          ...lines.slice(pattern.endIndex - 1),
        ];
        return collapsed.join('\n');
      }
    }
    return content;
  },
  
  // 2. Summarize unchanged sections
  summarizeUnchanged: (content: string, lastEditLine: number) => {
    const lines = content.split('\n');
    const CONTEXT_RADIUS = 30;
    
    const keepStart = Math.max(0, lastEditLine - CONTEXT_RADIUS);
    const keepEnd = Math.min(lines.length, lastEditLine + CONTEXT_RADIUS);
    
    const result = [];
    if (keepStart > 0) {
      result.push(`... [Lines 1-${keepStart}: preamble and setup] ...`);
    }
    result.push(...lines.slice(keepStart, keepEnd).map((l, i) => `${keepStart + i + 1}: ${l}`));
    if (keepEnd < lines.length) {
      result.push(`... [Lines ${keepEnd + 1}-${lines.length}: remaining content] ...`);
    }
    
    return result.join('\n');
  },
  
  // 3. Semantic chunking for LaTeX
  semanticChunk: (content: string) => {
    const structure = parseLatexStructure(content);
    
    return {
      preamble: structure.preamble,
      sections: structure.sections.map(s => ({
        title: s.title,
        lineRange: s.lineRange,
        preview: s.content.slice(0, 200) + '...',
      })),
      environments: structure.environments,
    };
  },
};
```

### 7.2 Semantic Document Representation

```typescript
// For LaTeX documents
interface LatexDocumentMap {
  preamble: {
    documentClass: string;
    packages: string[];
    customCommands: string[];
    lineRange: [number, number];
  };
  structure: DocumentSection[];
  environments: EnvironmentUsage[];
}

interface DocumentSection {
  type: 'section' | 'subsection' | 'chapter';
  title: string;
  lineRange: [number, number];
  contentPreview?: string;  // First 100 chars
}

interface EnvironmentUsage {
  name: string;  // 'figure', 'table', 'equation', etc.
  count: number;
  firstOccurrence: number;
}
```

### 7.3 Adaptive Compression

```typescript
function compressDocument(content: string, options: {
  focusLines?: [number, number];
  maxLines: number;
  preserveStructure?: boolean;
}): string {
  const lines = content.split('\n');
  const totalLines = lines.length;
  
  // Small document: show everything
  if (totalLines <= options.maxLines) {
    return numberLines(lines);
  }

  const parsed = parseLatexStructure(content);
  const preambleEnd = parsed.preamble.lineRange[1];
  
  // Always keep preamble
  const preamble = lines.slice(0, preambleEnd);
  let remaining = options.maxLines - preamble.length;

  // If focus region specified, prioritize it
  if (options.focusLines) {
    const [focusStart, focusEnd] = options.focusLines;
    const contextBefore = Math.max(preambleEnd, focusStart - 20);
    const contextAfter = Math.min(totalLines, focusEnd + 20);
    
    const focusRegion = lines.slice(contextBefore, contextAfter);
    
    return [
      ...numberLines(preamble, 1),
      `\n... [Lines ${preambleEnd + 1}-${contextBefore}: ${summarizeSections(parsed, preambleEnd, contextBefore)}] ...\n`,
      ...numberLines(focusRegion, contextBefore + 1),
      `\n... [Lines ${contextAfter + 1}-${totalLines}: ${summarizeSections(parsed, contextAfter, totalLines)}] ...\n`,
    ].join('\n');
  }

  // Default: head + section markers + tail
  const headCount = Math.floor(remaining * 0.6);
  const tailCount = remaining - headCount;
  
  const sectionSummary = parsed.structure
    .map(s => `${s.type}: "${s.title}" (L${s.lineRange[0]}-${s.lineRange[1]})`)
    .join(', ');
  
  return [
    ...numberLines(lines.slice(0, preambleEnd + headCount), 1),
    `\n... [${totalLines - preambleEnd - headCount - tailCount} lines omitted] ...`,
    `\nDocument structure: ${sectionSummary}\n`,
    ...numberLines(lines.slice(-tailCount), totalLines - tailCount + 1),
  ].join('\n');
}
```

### 7.4 Project File Summary

```typescript
function buildProjectSummary(files: ProjectFile[], currentFile: string): string {
  const entries = files.map(file => {
    const isCurrent = file.path === currentFile;
    const lines = file.content.split('\n').length;
    const ext = file.path.split('.').pop();
    
    if (isCurrent) {
      return `📄 ${file.path} (CURRENT) - ${lines} lines`;
    }
    
    // For non-current files, add brief info
    if (ext === 'tex') {
      const structure = parseLatexStructure(file.content);
      const sections = structure.structure.map(s => s.title).join(', ');
      return `📄 ${file.path} - ${lines} lines [${sections || 'no sections'}]`;
    }
    
    if (ext === 'bib') {
      const entryCount = (file.content.match(/@\w+\{/g) || []).length;
      return `📚 ${file.path} - ${entryCount} bibliography entries`;
    }
    
    return `📄 ${file.path} - ${lines} lines`;
  });
  
  return entries.join('\n');
}
```

---

## 8. Error Handling & Recovery

### 8.1 Edit Application Errors

```typescript
interface EditResult {
  editId: string;
  success: boolean;
  error?: {
    type: 'not_found' | 'ambiguous' | 'conflict';
    message: string;
    suggestion?: string;
  };
  appliedContent?: string;
}

async function safeApplyEdit(
  edit: StructuredEdit,
  content: string
): Promise<EditResult> {
  try {
    // Check for ambiguous matches
    if (edit.operation.type === 'replace' || edit.operation.type === 'delete') {
      const searchText = edit.operation.search;
      const matches = findAllOccurrences(content, searchText);
      
      if (matches.length === 0) {
        const suggestion = findSimilarContent(content, searchText);
        return {
          editId: edit.id,
          success: false,
          error: {
            type: 'not_found',
            message: `Could not find: "${searchText.slice(0, 50)}..."`,
            suggestion: suggestion 
              ? `Did you mean: "${suggestion.slice(0, 100)}..."?`
              : undefined,
          },
        };
      }
      
      if (matches.length > 1) {
        return {
          editId: edit.id,
          success: false,
          error: {
            type: 'ambiguous',
            message: `Found ${matches.length} matches. Include more context to be specific.`,
            suggestion: `Matches at lines: ${matches.map(m => m.line).join(', ')}`,
          },
        };
      }
    }

    const result = applySearchReplace(content, edit.operation);
    
    if (!result.success) {
      return {
        editId: edit.id,
        success: false,
        error: {
          type: 'not_found',
          message: result.error!,
        },
      };
    }

    return {
      editId: edit.id,
      success: true,
      appliedContent: result.content,
    };
  } catch (e) {
    return {
      editId: edit.id,
      success: false,
      error: {
        type: 'conflict',
        message: e instanceof Error ? e.message : 'Unknown error',
      },
    };
  }
}

// Find similar content for suggestions
function findSimilarContent(content: string, search: string): string | null {
  // Fuzzy match using Levenshtein distance
  const lines = content.split('\n');
  const searchLines = search.split('\n');
  
  if (searchLines.length === 1) {
    // Single line search - find closest match
    let bestMatch = null;
    let bestScore = 0;
    
    for (const line of lines) {
      const score = similarity(line, search);
      if (score > bestScore && score > 0.6) {
        bestScore = score;
        bestMatch = line;
      }
    }
    
    return bestMatch;
  }
  
  // Multi-line search - try to find similar block
  // ... implementation
  return null;
}
```

### 8.2 Streaming Error Recovery

```typescript
// In useChat configuration
const chat = useChat({
  api: '/api/agent/chat',
  
  onError: (error) => {
    console.error('Chat error:', error);
    
    if (error.message.includes('rate_limit')) {
      toast.warning('Rate limited. Retrying in 30 seconds...');
      setTimeout(() => chat.reload(), 30000);
      return;
    }
    
    if (error.message.includes('context_length')) {
      toast.error('Document too large. Try selecting a smaller region.');
      return;
    }
    
    toast.error(`Error: ${error.message}`);
  },
  
  onFinish: (message) => {
    // Check for partial failures in tool calls
    const toolResults = extractToolResults(message);
    const failures = toolResults.filter(r => !r.success);
    
    if (failures.length > 0) {
      toast.warning(
        `${failures.length} edit(s) could not be applied. Check the details.`
      );
    }
  },
});
```

### 8.3 Conflict Detection

```typescript
interface ConflictCheck {
  hasConflict: boolean;
  conflictType?: 'version_mismatch' | 'content_changed' | 'concurrent_edit';
  details?: string;
}

function checkForConflicts(
  edit: StructuredEdit,
  currentContent: string,
  expectedContent: string
): ConflictCheck {
  // Content has changed since edit was generated
  if (currentContent !== expectedContent) {
    // Check if the edit target still exists
    const searchText = getSearchText(edit.operation);
    if (searchText && !currentContent.includes(searchText)) {
      return {
        hasConflict: true,
        conflictType: 'content_changed',
        details: 'The target text has been modified or removed.',
      };
    }
  }
  
  return { hasConflict: false };
}
```

---

## 9. Migration Strategy

### Phase 1: Core Infrastructure (Week 1)

**Goals:**
- Implement search/replace edit engine
- Create VirtualDocument store
- Build context compiler

**Tasks:**
1. Create `lib/edit-engine.ts` with search/replace operations
2. Create `stores/document.ts` with VirtualDocument management
3. Create `lib/context-compiler.ts` for smart compression
4. Write unit tests for edit engine

**Files to create:**
```
lib/
  edit-engine.ts
  context-compiler.ts
  latex-parser.ts
stores/
  document.ts
types/
  edit.ts (new types)
```

### Phase 2: Backend (Week 2)

**Goals:**
- New API route with AI SDK `streamText`
- Redesigned tool schemas
- Updated system prompt

**Tasks:**
1. Create new `/api/agent/v2/chat/route.ts`
2. Implement new tools (edit_document, get_context, validate)
3. Build system prompt template
4. Create runtime context management

**Files to create:**
```
app/api/agent/v2/
  chat/route.ts
lib/agent/
  tools.ts
  prompt.ts
  runtime-context.ts
```

### Phase 3: Frontend (Week 3)

**Goals:**
- Replace `useChatStream` with `useChat`
- New edit decoration system
- Multi-file edit UI

**Tasks:**
1. Create `hooks/use-agent.ts` using AI SDK `useChat`
2. Migrate decoration logic to new edit format
3. Build pending edits panel component
4. Integrate with existing editor components

**Files to modify:**
```
hooks/
  use-agent.ts (new)
  use-edit-decorations.ts (refactor)
components/
  chat/index.tsx (update)
  pending-edits-panel.tsx (new)
```

### Phase 4: Polish & Testing (Week 4)

**Goals:**
- Error handling
- Edge cases (concurrent edits, large files)
- Performance optimization

**Tasks:**
1. Implement error recovery flows
2. Add conflict detection
3. Optimize context compression for large projects
4. End-to-end testing
5. Gradual rollout (feature flag)

---

## 10. Benefits Summary

| Aspect | Current Implementation | Proposed Implementation |
|--------|------------------------|------------------------|
| **Streaming** | Manual SSE parsing | AI SDK `useChat` built-in |
| **Edit Format** | Line-based (fragile) | Search/replace (robust) |
| **State Sync** | Manual Monaco ↔ Store | VirtualDocument (single source of truth) |
| **Context** | Hard truncation (100+100 lines) | Semantic compression |
| **Multi-file** | Afterthought (`targetFile` field) | First-class citizen |
| **Rebasing** | Complex line number shifting | Not needed |
| **Tool Calls** | Custom SSE protocol | AI SDK data stream protocol |
| **Error Handling** | Basic | Comprehensive with recovery |

### Quantified Improvements (Expected)

- **Edit Success Rate**: 75% → 95% (search/replace is more resilient)
- **Context Token Usage**: ~50% reduction with smart compression
- **Code Complexity**: ~40% reduction (AI SDK handles streaming)
- **Multi-file UX**: Full support vs partial support
- **Debugging**: Better with AI SDK built-in tracing

---

## Appendix: Type Definitions

```typescript
// types/edit.ts

export type EditOperationType = 
  | 'replace' 
  | 'insert_after' 
  | 'insert_before' 
  | 'delete' 
  | 'append' 
  | 'prepend';

export interface ReplaceOperation {
  type: 'replace';
  search: string;
  replace: string;
}

export interface InsertAfterOperation {
  type: 'insert_after';
  anchor: string;
  content: string;
}

export interface InsertBeforeOperation {
  type: 'insert_before';
  anchor: string;
  content: string;
}

export interface DeleteOperation {
  type: 'delete';
  search: string;
}

export interface AppendOperation {
  type: 'append';
  content: string;
}

export interface PrependOperation {
  type: 'prepend';
  content: string;
}

export type EditOperation = 
  | ReplaceOperation 
  | InsertAfterOperation 
  | InsertBeforeOperation 
  | DeleteOperation 
  | AppendOperation 
  | PrependOperation;

export interface StructuredEdit {
  id: string;
  targetFile: string;
  operation: EditOperation;
  explanation?: string;
  status: 'pending' | 'applied' | 'rejected' | 'error';
  error?: string;
  createdAt: number;
}

export interface VirtualDocument {
  path: string;
  baseContent: string;
  pendingEdits: StructuredEdit[];
  optimisticContent: string;
  version: number;
  lastModified: number;
}

export interface EditResult {
  editId: string;
  success: boolean;
  error?: {
    type: 'not_found' | 'ambiguous' | 'conflict';
    message: string;
    suggestion?: string;
  };
  appliedContent?: string;
}

export interface CompiledContext {
  currentFile: string;
  primaryDocument: string;
  projectSummary: string;
  expandedFiles: Array<{
    path: string;
    content: string;
  }>;
  tokenCount: number;
}
```

