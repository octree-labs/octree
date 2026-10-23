import { describe, it, expect } from 'vitest';
import { appendUtmParams, pickUtmParams } from '@/lib/utm';

describe('pickUtmParams', () => {
  it('keeps only utm_<letters> keys, in order', () => {
    const params = new URLSearchParams(
      'utm_source=tools&draft=x&utm_medium=cta&UTM_TERM=a&utm_=b&utm_content2=c&utm_campaign=hero&ref=y'
    );

    expect(pickUtmParams(params)).toEqual([
      ['utm_source', 'tools'],
      ['utm_medium', 'cta'],
      ['utm_campaign', 'hero'],
    ]);
  });

  it('caps values at 200 characters', () => {
    const [[, value]] = pickUtmParams(new URLSearchParams({ utm_campaign: 'a'.repeat(500) }));

    expect(value).toHaveLength(200);
  });

  it('skips empty values and repeated keys (first wins)', () => {
    expect(
      pickUtmParams(new URLSearchParams('utm_source=&utm_medium=cta&utm_medium=nav'))
    ).toEqual([['utm_medium', 'cta']]);
  });
});

describe('appendUtmParams', () => {
  it("adds the utm params and preserves the target's own query", () => {
    const target = new URL('https://app.useoctree.com/import?draft=abc');
    const result = appendUtmParams(
      target,
      new URLSearchParams('draft=evil&utm_source=tools&utm_campaign=templates')
    );

    expect(result).toBe(target);
    expect(result.toString()).toBe(
      'https://app.useoctree.com/import?draft=abc&utm_source=tools&utm_campaign=templates'
    );
  });

  it('leaves the target untouched without utm params', () => {
    const target = appendUtmParams(new URL('https://app.useoctree.com/'), new URLSearchParams('a=1'));

    expect(target.toString()).toBe('https://app.useoctree.com/');
  });
});
