import { StringEdit } from '@/lib/octra-agent/edits';

export interface EditSuggestion extends StringEdit {
  id: string;
  messageId?: string;
  status: 'pending' | 'accepted' | 'rejected';
  line_start?: number;
  /**
   * Where the edit came from. `ats`: a fix from the resume ATS analysis
   * (components/resume/ats-panel.tsx), a Pro feature of its own, so applying
   * it does not need AI edits left. Unset: the AI chat.
   */
  source?: 'ats';
}
