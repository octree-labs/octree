/**
 * Header the agent service (services/agent/lib/proxy-secret.ts) checks to
 * confirm a request came through this app's proxy, where quotas are enforced.
 */
export const AGENT_PROXY_SECRET_HEADER = 'x-octree-proxy-secret';

/** Headers for a server-to-server call to CLAUDE_AGENT_SERVICE_URL. */
export function agentServiceHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    authorization: `Bearer ${accessToken}`,
  };
  // Trim: a stray newline from `vercel env add` would make fetch throw.
  const secret = process.env.AGENT_SERVICE_SECRET?.trim();
  if (secret) headers[AGENT_PROXY_SECRET_HEADER] = secret;
  return headers;
}
