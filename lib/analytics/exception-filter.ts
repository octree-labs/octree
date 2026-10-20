import type { BeforeSendFn, CaptureResult } from 'posthog-js';

/**
 * Error messages that are browser/extension noise rather than application bugs.
 *
 * - "Object Not Found Matching Id:N, MethodName:update, ParamCount:4" is injected by
 *   Microsoft Edge / Outlook SafeLinks / Defender link-scanning scripts (an
 *   unhandled rejection from their own RPC layer). It accounted for 36/36 tools
 *   exceptions in a 48h window and would trip the exceptions alert.
 * - The two ResizeObserver strings are benign per-spec warnings fired by Chrome
 *   and Firefox when a layout pass is deferred one frame.
 */
export const NOISE_MESSAGE_PATTERNS: readonly RegExp[] = [
  /Object Not Found Matching Id:\s*\d+,\s*MethodName:\s*(update|remove)/i,
  /ResizeObserver loop limit exceeded/,
  /ResizeObserver loop completed with undelivered notifications/,
];

/**
 * posthog-js renders promise rejections whose reason is not an Error as one of
 *   "Non-Error promise rejection captured with value: <String(reason)>"
 *   "Object captured as exception with keys: a, b"
 *   "'ClassName' captured as exception with keys: a, b"
 * when the value carries no message. Those give us nothing to act on.
 */
const MESSAGELESS_REJECTION_PATTERNS: readonly RegExp[] = [
  /^Non-Error promise rejection captured with value:\s*(\[object [A-Za-z]+\]|undefined|null|)$/,
  /^(?:'[^']*'|Object) captured as exception with keys:/,
];

type ExceptionEntry = { type?: unknown; value?: unknown };

/** Every message string carried by an `$exception` event's properties (new and legacy shapes). */
export function exceptionMessages(properties: Record<string, unknown> | null | undefined): string[] {
  if (!properties) return [];
  const messages: string[] = [];

  const list = properties.$exception_list;
  if (Array.isArray(list)) {
    for (const entry of list as ExceptionEntry[]) {
      if (entry && typeof entry.value === 'string') messages.push(entry.value);
    }
  }
  // Legacy property set by older posthog-js versions and by manual captureException calls.
  if (typeof properties.$exception_message === 'string') messages.push(properties.$exception_message);

  return messages;
}

/** True when an `$exception` event's properties describe known noise rather than an app bug. */
export function isNoiseException(properties: Record<string, unknown> | null | undefined): boolean {
  const messages = exceptionMessages(properties);
  if (messages.length === 0) return false;
  return messages.every(
    (message) =>
      NOISE_MESSAGE_PATTERNS.some((re) => re.test(message)) ||
      MESSAGELESS_REJECTION_PATTERNS.some((re) => re.test(message.trim())),
  );
}

/**
 * PostHog `before_send` hook: drops `$exception` events that match the noise
 * signatures above and passes every other event through unchanged.
 */
export const dropNoiseExceptions: BeforeSendFn = (result: CaptureResult | null) => {
  if (!result || result.event !== '$exception') return result;
  return isNoiseException(result.properties) ? null : result;
};
