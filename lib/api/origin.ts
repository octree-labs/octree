/** The path of the MCP endpoint. */
export const MCP_PATH = '/api/mcp';

/** `https://app.useoctree.com` from a request (scheme + host, no path). */
export function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}
