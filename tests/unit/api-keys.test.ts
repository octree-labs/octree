import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  API_KEY_PREFIX,
  apiKeyDisplayPrefix,
  bearerToken,
  generateApiKey,
  hashApiKey,
  isApiKeyFormat,
  normalizeApiKeyName,
} from '@/lib/api/keys';

describe('API keys', () => {
  it('generates oct_live_ + 32 url-safe characters, unique each time', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey()));
    expect(keys.size).toBe(200);
    for (const key of keys) {
      expect(key).toMatch(/^oct_live_[A-Za-z0-9_-]{32}$/);
      expect(key.length).toBe(API_KEY_PREFIX.length + 32);
      expect(isApiKeyFormat(key)).toBe(true);
    }
  });

  it('rejects strings that are not keys', () => {
    expect(isApiKeyFormat('oct_live_short')).toBe(false);
    expect(isApiKeyFormat('oct_test_' + 'a'.repeat(32))).toBe(false);
    expect(isApiKeyFormat('oct_live_' + 'a'.repeat(31) + '!')).toBe(false);
    expect(isApiKeyFormat('oct_live_' + 'a'.repeat(33))).toBe(false);
    expect(isApiKeyFormat(undefined)).toBe(false);
  });

  it('hashes with sha256 hex (what api_keys.key_hash stores)', () => {
    const key = 'oct_live_' + 'x'.repeat(32);
    expect(hashApiKey(key)).toBe(createHash('sha256').update(key).digest('hex'));
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).not.toBe(hashApiKey(key.replace(/x$/, 'y')));
  });

  it('keeps the first 12 characters for display (matches the migration check)', () => {
    const key = generateApiKey();
    const prefix = apiKeyDisplayPrefix(key);
    expect(prefix).toHaveLength(12);
    expect(prefix).toMatch(/^oct_live_[A-Za-z0-9_-]{3}$/);
  });

  it('reads the bearer token from Authorization', () => {
    expect(bearerToken('Bearer oct_live_abc')).toBe('oct_live_abc');
    expect(bearerToken('bearer   oct_live_abc  ')).toBe('oct_live_abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it('normalises key names', () => {
    expect(normalizeApiKeyName('  Claude   Code ')).toBe('Claude Code');
    expect(normalizeApiKeyName('')).toBeNull();
    expect(normalizeApiKeyName('x'.repeat(65))).toBeNull();
    expect(normalizeApiKeyName(42)).toBeNull();
  });
});
