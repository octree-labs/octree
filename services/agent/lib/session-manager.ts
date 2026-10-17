/**
 * Session manager for maintaining editing session state
 * Uses Vercel AI SDK's generateText() for summary generation
 */

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

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
      const { text } = await generateText({
        model: anthropic('claude-haiku-4-5-20251001'),
        prompt,
      });

      this.updateSession(sessionId, text.trim());
      console.log(`[Session] Updated summary for ${sessionId}:`, text.trim().substring(0, 100) + '...');
    } catch (error) {
      console.error(`[Session] Failed to update session summary for ${sessionId}:`, error);
    }
  }
}
