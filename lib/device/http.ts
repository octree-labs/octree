/**
 * Request parsing for the device endpoints: JSON bodies, or
 * application/x-www-form-urlencoded as RFC 8628 clients send them. Bodies
 * are tiny, so anything over 4 KB is refused before parsing.
 */

export const DEVICE_MAX_BODY_BYTES = 4 * 1024;

export type ParsedDeviceBody = { ok: true; fields: Record<string, unknown> } | { ok: false; message: string };

export async function readDeviceBody(request: Request): Promise<ParsedDeviceBody> {
  if (Number(request.headers.get('content-length') ?? 0) > DEVICE_MAX_BODY_BYTES) {
    return { ok: false, message: 'Request body is too large.' };
  }
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > DEVICE_MAX_BODY_BYTES) return { ok: false, message: 'Request body is too large.' };
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
    return { ok: false, message: 'Body is not valid JSON (or send application/x-www-form-urlencoded).' };
  }
}
