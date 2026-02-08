export interface ConversationSummary {
  id?: string;
  title?: string;
  [key: string]: unknown;
}

export interface DocumentSession {
  conversationSummary: ConversationSummary | null;
  lastUserPrompt: string | null;
  lastAssistantResponse: string | null;
  interactionCount: number;
}

const STORAGE_KEY_PREFIX = 'octree_doc_session_';

function getStorageKey(documentId: string): string {
  return `${STORAGE_KEY_PREFIX}${documentId}`;
}

export function getDocumentSession(documentId: string): DocumentSession | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const stored = localStorage.getItem(getStorageKey(documentId));
    if (!stored) return null;
    return JSON.parse(stored) as DocumentSession;
  } catch {
    return null;
  }
}

export function setDocumentSession(documentId: string, session: DocumentSession): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem(getStorageKey(documentId), JSON.stringify(session));
  } catch (err) {
    console.error('Failed to save session to localStorage:', err);
  }
}

export function updateDocumentSession(
  documentId: string,
  updates: Partial<DocumentSession>
): DocumentSession {
  const existing = getDocumentSession(documentId) || {
    conversationSummary: null,
    lastUserPrompt: null,
    lastAssistantResponse: null,
    interactionCount: 0,
  };
  
  const updated = { ...existing, ...updates };
  setDocumentSession(documentId, updated);
  return updated;
}

export function deleteDocumentSession(documentId: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.removeItem(getStorageKey(documentId));
  } catch {
    // Ignore errors
  }
}

export function clearAllDocumentSessions(): void {
  if (typeof window === 'undefined') return;
  
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Ignore errors
  }
}
