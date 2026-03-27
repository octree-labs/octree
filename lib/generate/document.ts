import type { Json, Tables } from '@/database.types';
import type { ConversationSummary } from '@/types/conversation';

export interface StoredAttachment {
  id: string;
  name: string;
  type: 'image' | 'document';
  url: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Array<{
    id: string;
    name: string;
    type: 'image' | 'document';
    preview: string | null;
  }>;
}

export interface GeneratedDocument
  extends Omit<
    Tables<'generated_documents'>,
    'attachments' | 'message_history' | 'conversation_summary' | 'status' | 'created_at' | 'latex'
  > {
  attachments: StoredAttachment[];
  message_history: StoredMessage[];
  conversation_summary: ConversationSummary | null;
  status: Tables<'generated_documents'>['status'];
  created_at: string;
  latex: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseAttachments(value: Json | null): StoredAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): StoredAttachment | null => {
      if (!isObject(item)) return null;
      const { id, name, type, url } = item;
      if (
        typeof id === 'string' &&
        typeof name === 'string' &&
        typeof url === 'string' &&
        (type === 'image' || type === 'document')
      ) {
        return { id, name, type, url };
      }
      return null;
    })
    .filter((item): item is StoredAttachment => item !== null);
}

function parseMessageAttachments(value: unknown): StoredMessage['attachments'] {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .map((item) => {
      if (!isObject(item)) return null;
      const { id, name, type, preview } = item;
      if (
        typeof id === 'string' &&
        typeof name === 'string' &&
        (type === 'image' || type === 'document') &&
        (typeof preview === 'string' || preview === null)
      ) {
        return { id, name, type, preview };
      }
      return null;
    })
    .filter((item): item is NonNullable<StoredMessage['attachments']>[number] => item !== null);
  return parsed.length ? parsed : undefined;
}

function parseMessageHistory(value: Json | null): StoredMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): StoredMessage | null => {
      if (!isObject(item)) return null;
      const { id, role, content, attachments } = item;
      if (
        typeof id === 'string' &&
        (role === 'user' || role === 'assistant') &&
        typeof content === 'string'
      ) {
        return {
          id,
          role,
          content,
          attachments: parseMessageAttachments(attachments),
        };
      }
      return null;
    })
    .filter((item): item is StoredMessage => item !== null);
}

function parseConversationSummary(value: Json | null): ConversationSummary | null {
  if (!isObject(value)) return null;
  const { original_intent, modifications_made, current_state, interaction_count } = value;
  if (
    typeof original_intent === 'string' &&
    Array.isArray(modifications_made) &&
    modifications_made.every((entry) => typeof entry === 'string') &&
    typeof current_state === 'string' &&
    typeof interaction_count === 'number'
  ) {
    return {
      original_intent,
      modifications_made,
      current_state,
      interaction_count,
    };
  }
  return null;
}

export function normalizeGeneratedDocument(row: Tables<'generated_documents'>): GeneratedDocument {
  return {
    ...row,
    attachments: parseAttachments(row.attachments),
    message_history: parseMessageHistory(row.message_history),
    conversation_summary: parseConversationSummary(row.conversation_summary),
    created_at: row.created_at ?? '',
    latex: row.latex ?? '',
  };
}
