import type { StringEdit } from '@octree/agent-protocol';

export interface EditSuggestion extends StringEdit {
  id: string;
  messageId?: string;
  status: 'pending' | 'accepted' | 'rejected';
  line_start?: number;
}
