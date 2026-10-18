/**
 * Browser-side Reddit conversion tracking: fires the pixel and mirrors the
 * event to the server-side CAPI route so it is counted even when the pixel is
 * blocked. Safe to call anywhere in the client; never throws.
 */
export function trackRedditEvent(eventName: string, email?: string): string {
  const conversionId = crypto.randomUUID();

  try {
    window.rdt?.('track', eventName, { conversionId });
  } catch (error) {
    console.error('Reddit pixel error:', error);
  }

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(
        '/api/reddit-capi',
        new Blob([JSON.stringify({ eventName, conversionId, email })], {
          type: 'application/json',
        })
      );
    }
  } catch (error) {
    console.error('Reddit CAPI beacon error:', error);
  }

  return conversionId;
}
