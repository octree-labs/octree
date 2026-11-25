// Claim checks for Supabase JWTs presented to the agent service.
//
// A valid signature alone is not enough: the public anon key is itself a
// Supabase-signed JWT (role "anon"), and so is the service-role key. The only
// caller of /agent is the Next.js app forwarding a signed-in user's session
// access token, so only `role: "authenticated"` tokens with a user id (`sub`)
// are accepted.

export const ALLOWED_SECRET_ALGORITHMS = ['HS256'] as const;
export const ALLOWED_JWKS_ALGORITHMS = ['ES256', 'RS256'] as const;

export interface AgentUserClaims {
  sub: string;
  role: 'authenticated';
}

export function getAgentUserClaims(payload: unknown): AgentUserClaims | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { role, sub } = payload as Record<string, unknown>;
  if (role !== 'authenticated') return null;
  if (typeof sub !== 'string' || sub.trim() === '') return null;
  return { sub, role };
}
