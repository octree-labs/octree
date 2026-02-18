import { StringEdit } from '@/lib/octra-agent/edits';

// EditSuggestion format using string-matching edits
export interface EditSuggestion extends StringEdit {
  id: string;
  messageId?: string; // ID of the chat message that created this suggestion
  status: 'pending' | 'accepted' | 'rejected';
}
