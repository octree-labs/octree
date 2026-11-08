/**
 * How much the browser can send to /api/generate-document in one request.
 *
 * Vercel refuses request bodies over 4.5 MB with a 413 before the route
 * runs. Attachments travel base64-encoded inside the JSON body (4/3 of
 * their size), next to the prompt and, on a follow-up, the current
 * document, so the old 5 MB attachment cap let through files the platform
 * then rejected.
 */
export const REQUEST_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

/** Room kept for the prompt, the current document and JSON overhead. */
const NON_ATTACHMENT_HEADROOM_BYTES = 512 * 1024;

/** Largest total of raw attachment bytes that still fits in one request. */
export const MAX_ATTACHMENT_BYTES = Math.floor(
  ((REQUEST_BODY_LIMIT_BYTES - NON_ATTACHMENT_HEADROOM_BYTES) * 3) / 4
);

export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

export type RequestSizeCheck =
  | { ok: true; estimatedBytes: number }
  | { ok: false; estimatedBytes: number; attachmentBytes: number; message: string };

/**
 * Estimates the JSON body size of a generate request and says whether it
 * fits, with a message the user can act on when it does not.
 */
export function checkGenerateRequestSize(input: {
  promptLength: number;
  currentLatexLength?: number;
  attachmentSizes: number[];
}): RequestSizeCheck {
  const attachmentBytes = input.attachmentSizes.reduce((sum, n) => sum + n, 0);
  const base64Bytes = Math.ceil(attachmentBytes / 3) * 4;
  // Text can be multi-byte and gets JSON-escaped; count it generously.
  const textBytes = (input.promptLength + (input.currentLatexLength ?? 0)) * 2;
  const estimatedBytes = base64Bytes + textBytes + 4 * 1024;

  if (attachmentBytes <= MAX_ATTACHMENT_BYTES && estimatedBytes <= REQUEST_BODY_LIMIT_BYTES) {
    return { ok: true, estimatedBytes };
  }

  const message =
    attachmentBytes > MAX_ATTACHMENT_BYTES
      ? `Your attachments add up to ${formatMegabytes(attachmentBytes)}; one request can carry ` +
        `${formatMegabytes(MAX_ATTACHMENT_BYTES)}. Remove a file, or attach only the pages you need ` +
        '(a smaller or compressed PDF, or a screenshot), and try again.'
      : 'This request is too large to send: the prompt, the current document and the attachments ' +
        `together go over ${formatMegabytes(REQUEST_BODY_LIMIT_BYTES)}. Shorten the prompt or remove an ` +
        'attachment and try again.';

  return { ok: false, estimatedBytes, attachmentBytes, message };
}
