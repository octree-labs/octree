import { apiJson } from '@/lib/api/http';

/**
 * Request parsing and responses of the OAuth endpoints (/oauth/token,
 * /oauth/register, /oauth/revoke).
 *
 * Bodies: application/x-www-form-urlencoded (RFC 6749; what Claude sends to
 * the token endpoint) or JSON (RFC 7591 registration, and lenient clients).
 * Responses are JSON with `Cache-Control: no-store`, and CORS-open: these
 * endpoints never read cookies, so a browser-based MCP client may call them.
 */

export type ParsedOAuthBody = { ok: true; fields: Record<string, unknown> } | { ok: false; message: string };

export async function readOAuthBody(request: Request, maxBytes: number): Promise<ParsedOAuthBody> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) return { ok: false, message: 'Request body is too large.' };
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, message: 'Request body is too large.' };
  if (!text.trim()) return { ok: true, fields: {} };

  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (type.includes('application/x-www-form-urlencoded')) {
    return { ok: true, fields: Object.fromEntries(new URLSearchParams(text)) };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, message: 'Body must be a JSON object.' };
    }
    return { ok: true, fields: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, message: 'Send application/x-www-form-urlencoded (or a JSON object).' };
  }
}

/**
 * client_id from `Authorization: Basic base64(client_id:)` (some public
 * clients send an empty secret this way), or undefined. A non-empty secret
 * is refused: no client has one.
 */
export function basicClientId(header: string | null): { clientId?: string; secretSent: boolean } {
  if (!header || !/^Basic\s+/i.test(header)) return { secretSent: false };
  try {
    const decoded = Buffer.from(header.replace(/^Basic\s+/i, '').trim(), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    const id = decodeURIComponent(colon >= 0 ? decoded.slice(0, colon) : decoded);
    const secret = colon >= 0 ? decoded.slice(colon + 1) : '';
    return { clientId: id || undefined, secretSent: secret.length > 0 };
  } catch {
    return { secretSent: false };
  }
}

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return apiJson(body, status, { Pragma: 'no-cache', ...extra });
}

/** RFC 6749 section 5.2 error. */
export function oauthError(error: string, description: string, status = 400, extra: Record<string, string> = {}): Response {
  return oauthJson({ error, error_description: description }, status, extra);
}
