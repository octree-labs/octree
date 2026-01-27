import { query } from '@anthropic-ai/claude-agent-sdk';

interface LastInteraction {
  userRequest: string;
  assistantResponse: string;
  timestamp: number;
}

interface SessionState {
  summary: string;
  lastInteraction: LastInteraction | null;
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
    const session = this.sessions.get(sessionId);
    console.log(`[Session] getSession(${sessionId}): ${session ? 'FOUND' : 'NOT FOUND'}, mapSize=${this.sessions.size}`);
    return session;
  }

  /**
   * Store the last interaction IMMEDIATELY for instant memory.
   * This is called right after the response completes, before summary generation.
   */
  storeLastInteraction(sessionId: string, userRequest: string, assistantResponse: string): void {
    const existing = this.sessions.get(sessionId);
    this.sessions.set(sessionId, {
      summary: existing?.summary || '',
      lastInteraction: {
        userRequest,
        assistantResponse,
        timestamp: Date.now(),
      },
      lastUpdated: Date.now(),
    });
    console.log(`[Session] storeLastInteraction(${sessionId}): stored immediately`);
  }

  updateSession(sessionId: string, summary: string): void {
    const existing = this.sessions.get(sessionId);
    this.sessions.set(sessionId, {
      summary,
      lastInteraction: existing?.lastInteraction || null,
      lastUpdated: Date.now(),
    });
    console.log(`[Session] updateSession(${sessionId}): mapSize now=${this.sessions.size}, summaryLength=${summary?.length || 0}`);
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
      let chunkCount = 0;
      for await (const chunk of result) {
        chunkCount++;
        const msg = chunk as any;
        if (chunkCount <= 3) {
          console.log('[Session] chunk sample:', JSON.stringify(msg).substring(0, 300));
        }
        if (msg.type === 'stream_event') {
            const delta = msg.event?.delta;
            if (delta?.text) {
                newSummary += delta.text;
            }
        }
        // Also check for assistant_message events
        if (msg.type === 'assistant_message' && msg.message?.content) {
            for (const block of msg.message.content) {
                if (block.type === 'text') {
                    newSummary = block.text; // Use full text
                }
            }
        }
        // Check for result event with text
        if (msg.type === 'result' && typeof msg.result === 'string') {
            newSummary = msg.result;
        }
      }
      console.log(`[Session] Generated summary: chunkCount=${chunkCount}, length=${newSummary.length}, preview: "${newSummary.substring(0, 80)}..."`);

      this.updateSession(sessionId, newSummary.trim());
      console.log(`[Session] Updated summary for ${sessionId}:`, newSummary.trim().substring(0, 100) + '...');
    } catch (error) {
      console.error(`[Session] Failed to update session summary for ${sessionId}:`, error);
    }
  }
}
