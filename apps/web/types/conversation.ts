export interface ConversationSummary {
  original_intent: string;
  modifications_made: string[];
  current_state: string;
  interaction_count: number;
}

export interface ConversationContext {
  current_latex: string;
  summary: ConversationSummary | null;
  last_user_prompt: string | null;
  last_assistant_response: string | null;
  new_prompt: string;
}
