import { query } from '@anthropic-ai/claude-agent-sdk';

interface SessionState {
  summary: string;
  lastUpdated: number;
}

export class SessionManager {
  private static instance: SessionManager;
  private sessions: Map<string, SessionState>;

  private constructor() {
    this.sessions = new Map();
  }

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  updateSession(sessionId: string, state: SessionState): void {
    this.sessions.set(sessionId, state);
  }

  /**
   * Generates a concise summary of the session based on the latest interaction.
   * This runs asynchronously to avoid blocking the response.
   */
  async generateUpdatedSummary(
    sessionId: string,
    currentSummary: string,
    userRequest: string,
    assistantResponse: string
  ): Promise<void> {
    const prompt = `
You are a technical documentation assistant. 
Your task is to update the "Editing Session Summary" for a LaTeX editing session.

CURRENT SUMMARY:
${currentSummary || '(No summary yet)'}

LATEST INTERACTION:
User: ${userRequest}
Assistant: ${assistantResponse}

INSTRUCTIONS:
1. Update the summary to include the latest changes and decisions.
2. Focus on:
   - Specific objects created or modified (tables, figures, sections).
   - The user's current focus or goal.
   - Any constraints or preferences established.
3. Remove obsolete details (e.g., intermediate steps that are done).
4. Keep it concise (under 200 words).
5. Output ONLY the new summary text.
`;

    try {
      const result = await query({
        prompt,
        options: {
            model: 'claude-haiku-4-5-20251001',
        }
      });

      let newSummary = '';
      for await (const chunk of result) {
        const msg = chunk as any;
        if (msg.type === 'stream_event') {
            const delta = msg.event?.delta;
            if (delta?.text) {
                newSummary += delta.text;
            }
        }
      }

      this.updateSession(sessionId, {
        summary: newSummary.trim(),
        lastUpdated: Date.now(),
      });
    } catch (error) {
      console.error(`Failed to update session summary for ${sessionId}:`, error);
    }
  }
}
