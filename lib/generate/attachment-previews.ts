import type { SupabaseClient } from '@supabase/supabase-js';
import { createSignedUrlMap, storagePathFromUrl } from '@/lib/storage/signed-urls';

export const CHAT_ATTACHMENTS_BUCKET = 'chat-attachments';

/**
 * A chat attachment as shown in a message. `path` is its object path in
 * `chat-attachments`; `preview` is what an <img> renders (a blob: URL while
 * the message is fresh, a signed URL once restored, null otherwise).
 */
export interface PreviewableAttachment {
  type: 'image' | 'document';
  preview: string | null;
  path?: string;
}

/**
 * Storage path of an attachment. Rows written before the bucket went private
 * hold a public URL instead of a path (`url` on generated_documents.attachments,
 * `preview` in message_history); the path is read back out of it.
 */
export function attachmentStoragePath(att: {
  path?: string | null;
  url?: string | null;
  preview?: string | null;
}): string | null {
  return (
    att.path ||
    storagePathFromUrl(att.url, CHAT_ATTACHMENTS_BUCKET) ||
    storagePathFromUrl(att.preview, CHAT_ATTACHMENTS_BUCKET)
  );
}

/**
 * Records the storage path and clears previews that point at storage: such a
 * URL (public, or a signed one that has expired) is not usable as is and is
 * replaced by a fresh signed URL in signAttachmentPreviews.
 */
export function normalizeAttachment<T extends PreviewableAttachment>(att: T & { url?: string | null }): T {
  const path = attachmentStoragePath(att);
  if (!path) return att;
  const { url: _legacyUrl, ...rest } = att;
  return { ...(rest as T), path, preview: null };
}

type MessageWithAttachments<A extends PreviewableAttachment> = {
  attachments?: A[];
};

export function normalizeMessageAttachments<A extends PreviewableAttachment, M extends MessageWithAttachments<A>>(
  messages: M[]
): M[] {
  return messages.map((m) =>
    m.attachments?.length ? { ...m, attachments: m.attachments.map((a) => normalizeAttachment(a)) } : m
  );
}

/**
 * Gives every stored image attachment a signed preview URL, with one batched
 * signing request for the whole conversation. Returns the input unchanged
 * when there is nothing to sign.
 */
export async function signAttachmentPreviews<A extends PreviewableAttachment, M extends MessageWithAttachments<A>>(
  client: Pick<SupabaseClient, 'storage'>,
  messages: M[]
): Promise<M[]> {
  const normalized = normalizeMessageAttachments<A, M>(messages);
  const paths = normalized.flatMap((m) =>
    (m.attachments ?? []).filter((a) => a.type === 'image' && a.path).map((a) => a.path as string)
  );
  if (paths.length === 0) return messages;

  const signed = await createSignedUrlMap(client, CHAT_ATTACHMENTS_BUCKET, paths);
  return normalized.map((m) =>
    m.attachments?.length
      ? {
          ...m,
          attachments: m.attachments.map((a) =>
            a.type === 'image' && a.path ? { ...a, preview: signed.get(a.path) ?? null } : a
          ),
        }
      : m
  );
}
