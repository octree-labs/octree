import { vi } from 'vitest';
import type * as Monaco from 'monaco-editor';

export class FakeRange implements Monaco.IRange {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number
  ) {}
}

/** Minimal Monaco text model backed by a string; supports the calls the edit flow makes */
export class FakeModel {
  constructor(private text: string) {}

  getValue() { return this.text; }
  getLineCount() { return this.text.split('\n').length; }
  getLineMaxColumn(line: number) { return (this.text.split('\n')[line - 1]?.length ?? 0) + 1; }

  findMatches(search: string) {
    const matches: { range: FakeRange }[] = [];
    for (let i = this.text.indexOf(search); i !== -1; i = this.text.indexOf(search, i + 1)) {
      const start = this.positionAt(i);
      const end = this.positionAt(i + search.length);
      matches.push({ range: new FakeRange(start.line, start.column, end.line, end.column) });
    }
    return matches;
  }

  /** Apply edits atomically, like Monaco: all ranges refer to the text before any edit */
  applyEdits(edits: { range: Monaco.IRange; text: string }[]) {
    const resolved = edits
      .map((e) => ({
        start: this.offsetAt(e.range.startLineNumber, e.range.startColumn),
        end: this.offsetAt(e.range.endLineNumber, e.range.endColumn),
        text: e.text,
      }))
      .sort((a, b) => b.start - a.start);
    for (const e of resolved) {
      this.text = this.text.slice(0, e.start) + e.text + this.text.slice(e.end);
    }
  }

  private positionAt(offset: number) {
    const before = this.text.slice(0, offset).split('\n');
    return { line: before.length, column: before[before.length - 1].length + 1 };
  }

  private offsetAt(line: number, column: number) {
    const lines = this.text.split('\n');
    let offset = 0;
    for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1;
    return offset + column - 1;
  }
}

export function createFakeEditor(initial: string) {
  const model = new FakeModel(initial);
  const executeEdits = vi.fn((_source: string, edits: { range: Monaco.IRange; text: string }[]) => {
    model.applyEdits(edits);
    return true;
  });
  const editor = {
    executeEdits,
    deltaDecorations: vi.fn().mockReturnValue([]),
    getModel: vi.fn(() => model),
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  const monacoInstance = {
    Range: FakeRange,
    editor: { TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 } },
  } as unknown as typeof Monaco;
  return { editor, monacoInstance, executeEdits, model };
}
