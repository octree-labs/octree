import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

/**
 * Encryption of the API key held between approval (/activate) and the
 * agent's next poll (/api/v1/device/token). The plaintext key exists in the
 * database only as AES-256-GCM ciphertext, for at most the 15-minute life of
 * the request, and the column is cleared as soon as the agent receives it.
 *
 * Key: HKDF-SHA256 over a server secret, info "octree/device-flow/v1".
 *   DEVICE_FLOW_SECRET          preferred: a dedicated random secret
 *                               (e.g. `openssl rand -base64 32`).
 *   SUPABASE_SERVICE_ROLE_KEY   fallback when DEVICE_FLOW_SECRET is unset.
 *                               Anyone holding it can already read every row,
 *                               so this adds no new exposure; set the
 *                               dedicated secret so a leaked database dump
 *                               alone is not enough.
 * Rotating the secret only breaks requests approved in the last 15 minutes
 * (they fail to decrypt and the agent is told to start again).
 *
 * The row id is bound as additional authenticated data, so a ciphertext
 * copied onto another row does not decrypt.
 *
 * Format: `v1.<iv b64url>.<tag b64url>.<ciphertext b64url>`.
 */

const VERSION = 'v1';
const HKDF_SALT = 'octree-device-flow';
const HKDF_INFO = 'octree/device-flow/v1';

export function deviceFlowSecret(env: Record<string, string | undefined> = process.env): string | null {
  const dedicated = env.DEVICE_FLOW_SECRET?.trim();
  if (dedicated) return dedicated;
  const fallback = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return fallback || null;
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), HKDF_SALT, HKDF_INFO, 32));
}

export function encryptDeviceKey(plaintext: string, rowId: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  cipher.setAAD(Buffer.from(rowId, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), body.toString('base64url')].join('.');
}

/** The plaintext, or null when the value is malformed, tampered with, or from another secret or row. */
export function decryptDeviceKey(value: string, rowId: string, secret: string): string | null {
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, iv, tag, body] = parts;
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64url'), {
      authTagLength: 16,
    });
    decipher.setAAD(Buffer.from(rowId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
