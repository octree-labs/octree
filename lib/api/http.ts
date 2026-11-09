/**
 * Response helpers shared by the public API routes (app/api/v1/**) and the
 * MCP endpoint (app/api/mcp). Every response carries permissive CORS
 * headers: the API is authenticated by a bearer key, never by cookies, so
 * `Access-Control-Allow-Origin: *` lets browser-based agents call it without
 * exposing anything a cookie would.
 */

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate, Retry-After',
  'Access-Control-Max-Age': '86400',
};

const BASE_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function apiJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

export function apiPdf(pdf: Uint8Array, extra: Record<string, string> = {}): Response {
  return new Response(pdf as BodyInit, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.byteLength),
      'Content-Disposition': 'inline; filename="output.pdf"',
      ...extra,
    },
  });
}

/** 204 answer to a CORS preflight. */
export function apiPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Adds the CORS headers to a response produced elsewhere (the MCP transport). */
export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
