import { describe, it, expect } from 'vitest';

import {
  createUserUnsubscribeToken,
  userUnsubscribeUrl,
  verifyUserUnsubscribeToken,
} from '@/lib/email/unsubscribe';

const SECRET = 'test-secret';
const USER = '3f3a8d1e-7c7b-4d2a-9d33-1a2b3c4d5e6f';

describe('user unsubscribe token', () => {
  it('round-trips the user id', () => {
    const token = createUserUnsubscribeToken(USER, SECRET);
    expect(token).not.toContain(USER);
    expect(verifyUserUnsubscribeToken(token, SECRET)).toBe(USER);
  });

  it('rejects a tampered id, a tampered signature and the wrong secret', () => {
    const token = createUserUnsubscribeToken(USER, SECRET);
    const [id, sig] = token.split('.');
    const otherId = Buffer.from('00000000-0000-0000-0000-000000000000').toString('base64url');
    expect(verifyUserUnsubscribeToken(`${otherId}.${sig}`, SECRET)).toBeNull();
    expect(verifyUserUnsubscribeToken(`${id}.${sig.slice(0, -1)}x`, SECRET)).toBeNull();
    expect(verifyUserUnsubscribeToken(token, 'other-secret')).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyUserUnsubscribeToken('', SECRET)).toBeNull();
    expect(verifyUserUnsubscribeToken('nodot', SECRET)).toBeNull();
    expect(verifyUserUnsubscribeToken('.sig', SECRET)).toBeNull();
    expect(verifyUserUnsubscribeToken('id.', SECRET)).toBeNull();
  });

  it('builds the unsubscribe URL with the token url-encoded', () => {
    const url = userUnsubscribeUrl(USER, SECRET, 'https://app.example.com');
    expect(url.startsWith('https://app.example.com/api/email/unsubscribe?token=')).toBe(true);
    const token = new URL(url).searchParams.get('token')!;
    expect(verifyUserUnsubscribeToken(token, SECRET)).toBe(USER);
  });
});
