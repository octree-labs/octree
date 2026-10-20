import { describe, expect, test } from 'vitest';

import {
  dropNoiseExceptions,
  exceptionMessages,
  isNoiseException,
} from '@/lib/analytics/exception-filter';

const exception = (value: string, type = 'Error') => ({
  uuid: 'u',
  event: '$exception' as const,
  properties: { $exception_list: [{ type, value, mechanism: { handled: false } }] },
});

describe('dropNoiseExceptions', () => {
  test('drops the Edge/Outlook SafeLinks "Object Not Found Matching Id" rejection', () => {
    const event = exception(
      'Non-Error promise rejection captured with value: Object Not Found Matching Id:3, MethodName:update, ParamCount:4',
      'UnhandledRejection',
    );
    expect(dropNoiseExceptions(event)).toBeNull();
    expect(
      isNoiseException({
        $exception_message: 'Object Not Found Matching Id:12, MethodName:remove, ParamCount:2',
      }),
    ).toBe(true);
  });

  test('drops the benign ResizeObserver warnings', () => {
    expect(dropNoiseExceptions(exception('ResizeObserver loop limit exceeded'))).toBeNull();
    expect(
      dropNoiseExceptions(exception('ResizeObserver loop completed with undelivered notifications.')),
    ).toBeNull();
  });

  test('drops non-Error rejections that carry no message', () => {
    for (const value of [
      'Non-Error promise rejection captured with value: [object Object]',
      'Non-Error promise rejection captured with value: undefined',
      'Non-Error promise rejection captured with value: ',
      'Object captured as exception with keys: isTrusted',
      "'Event' captured as exception with keys: isTrusted",
    ]) {
      expect(dropNoiseExceptions(exception(value, 'UnhandledRejection')), value).toBeNull();
    }
  });

  test('keeps real errors, including rejections with a message', () => {
    for (const value of [
      "Cannot read properties of undefined (reading 'latex')",
      'Non-Error promise rejection captured with value: Compile failed: missing \\begin{document}',
      'Object Not Found Matching Id:3, MethodName:fetch, ParamCount:4',
      'Failed to fetch',
    ]) {
      const event = exception(value, 'UnhandledRejection');
      expect(dropNoiseExceptions(event), value).toBe(event);
    }
  });

  test('keeps an exception event with no recognisable message', () => {
    const event = { uuid: 'u', event: '$exception' as const, properties: {} };
    expect(dropNoiseExceptions(event)).toBe(event);
    expect(isNoiseException(undefined)).toBe(false);
  });

  test('drops only when every listed exception is noise', () => {
    const mixed = {
      uuid: 'u',
      event: '$exception' as const,
      properties: {
        $exception_list: [
          { type: 'Error', value: 'ResizeObserver loop limit exceeded' },
          { type: 'TypeError', value: 'x is not a function' },
        ],
      },
    };
    expect(dropNoiseExceptions(mixed)).toBe(mixed);
    expect(exceptionMessages(mixed.properties)).toEqual([
      'ResizeObserver loop limit exceeded',
      'x is not a function',
    ]);
  });

  test('passes every non-exception event through untouched', () => {
    const pageview = { uuid: 'u', event: '$pageview' as const, properties: {} };
    expect(dropNoiseExceptions(pageview)).toBe(pageview);
    expect(dropNoiseExceptions(null)).toBeNull();
  });
});
