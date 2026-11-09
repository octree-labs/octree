import { createHash, randomBytes } from 'crypto';

/**
 * Octree API keys: `oct_live_` + 32 url-safe random characters.
 *
 * Only the sha256 hex digest is stored (`api_keys.key_hash`); the plaintext
 * is shown once, at creation. A sha256 lookup by hash needs no constant-time
 * compare: the attacker never gets to compare against a chosen digest. Keys
 * must never be logged; log the `key_prefix` at most.
 */

export const API_KEY_PREFIX = 'oct_live_';
/** Random characters after the prefix. */
export const API_KEY_RANDOM_LENGTH = 32;
/** Characters of the key kept for display (`oct_live_abc`). */
export const API_KEY_DISPLAY_PREFIX_LENGTH = 12;
/** Active (not revoked) keys a user may hold at once. */
export const MAX_ACTIVE_API_KEYS = 5;
export const API_KEY_NAME_MAX_LENGTH = 64;

const API_KEY_RE = new RegExp(`^${API_KEY_PREFIX}[A-Za-z0-9_-]{${API_KEY_RANDOM_LENGTH}}$`);

/** A fresh plaintext key. 24 random bytes are exactly 32 base64url characters (192 bits). */
export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(24).toString('base64url');
}

/** Whether a string has the shape of an Octree API key (says nothing about validity). */
export function isApiKeyFormat(value: unknown): value is string {
  return typeof value === 'string' && API_KEY_RE.test(value);
}

/** sha256 hex digest stored in `api_keys.key_hash`. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** The first 12 characters, stored in `api_keys.key_prefix` for display. */
export function apiKeyDisplayPrefix(key: string): string {
  return key.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);
}

/** Trimmed key name, or null when empty or too long. */
export function normalizeApiKeyName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > API_KEY_NAME_MAX_LENGTH) return null;
  return trimmed;
}

/** The key from an `Authorization: Bearer <key>` header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
