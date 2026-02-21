import { StringEdit } from '@/lib/octra-agent/edits';

export interface EditSuggestion extends StringEdit {
  id: string;
  messageId?: string;
  status: 'pending' | 'accepted' | 'rejected';
  line_start?: number;
}
