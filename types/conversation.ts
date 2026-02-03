export interface ConversationSummary {
  original_intent: string;
  modifications_made: string[];
  current_state: string;
  interaction_count: number;
}

export interface ConversationContext {
  currentLatex: string;
  summary: ConversationSummary | null;
  lastUserPrompt: string | null;
  lastAssistantResponse: string | null;
}
