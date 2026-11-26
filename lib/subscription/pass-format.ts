/**
 * How a Deadline Pass end is shown (Settings, /success): "December 3, 2:30 PM"
 * in the viewer's locale and time zone. Call it in the browser.
 */
export function formatPassEnd(end: Date): string {
  return end.toLocaleString(undefined, { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
