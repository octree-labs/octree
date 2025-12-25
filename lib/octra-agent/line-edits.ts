export type LineEditType = 'insert' | 'delete' | 'replace';

export interface LineEdit {
  editType: LineEditType;
  content?: string;
  position?: {
    line?: number;
  };
  originalLineCount?: number;
  explanation?: string;
  targetFile?: string; // Path of the file this edit targets (for multi-file projects)
}

