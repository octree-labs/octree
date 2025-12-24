import { LineEdit } from '@/lib/octra-agent/line-edits';

// EditSuggestion format using line-based edits
export interface EditSuggestion extends LineEdit {
  id: string;
  messageId?: string; // ID of the chat message that created this suggestion
  status: 'pending' | 'accepted' | 'rejected';
  original?: string; // Original content for delete operations
}
