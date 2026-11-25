import { describe, it, expect, afterEach } from 'vitest';
import {
  PROXY_SECRET_HEADER,
  checkProxySecret,
  safeEqual,
} from '@/services/agent/lib/proxy-secret';
import {
  AGENT_PROXY_SECRET_HEADER,
  agentServiceHeaders,
} from '@/lib/octra-agent/agent-service-request';

describe('agent service proxy secret check', () => {
  it('passes through when no secret is configured (rollout mode)', () => {
    expect(checkProxySecret(undefined, undefined)).toBe('disabled');
    expect(checkProxySecret('', 'anything')).toBe('disabled');
  });

  it('rejects a missing header', () => {
    expect(checkProxySecret('s3cret', undefined)).toBe('missing');
    expect(checkProxySecret('s3cret', '')).toBe('missing');
  });

  it('rejects a wrong header, including different lengths and repeated headers', () => {
    expect(checkProxySecret('s3cret', 's3creT')).toBe('invalid');
    expect(checkProxySecret('s3cret', 's3cret-longer')).toBe('invalid');
    expect(checkProxySecret('s3cret', 's')).toBe('invalid');
    expect(checkProxySecret('s3cret', ['s3cret', 's3cret'])).toBe('invalid');
  });

  it('accepts the right header', () => {
    expect(checkProxySecret('s3cret', 's3cret')).toBe('ok');
  });

  it('safeEqual compares values of any length', () => {
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'ab')).toBe(false);
  });

  it('uses the same header name on both sides', () => {
    expect(AGENT_PROXY_SECRET_HEADER).toBe(PROXY_SECRET_HEADER);
  });
});

describe('agentServiceHeaders', () => {
  const original = process.env.AGENT_SERVICE_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.AGENT_SERVICE_SECRET;
    else process.env.AGENT_SERVICE_SECRET = original;
  });

  it('adds the proxy secret when AGENT_SERVICE_SECRET is set', () => {
    process.env.AGENT_SERVICE_SECRET = 'shh';
    const headers = agentServiceHeaders('tok');
    expect(headers.authorization).toBe('Bearer tok');
    expect(headers[AGENT_PROXY_SECRET_HEADER]).toBe('shh');
  });

  it('omits the header when AGENT_SERVICE_SECRET is unset', () => {
    delete process.env.AGENT_SERVICE_SECRET;
    expect(agentServiceHeaders('tok')).not.toHaveProperty(AGENT_PROXY_SECRET_HEADER);
  });
});
