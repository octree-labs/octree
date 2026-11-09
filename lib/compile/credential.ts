import { createHmac } from 'crypto';

/**
 * Server credential for the compile service (services/compile/internal/auth.go
 * accepts HS256 tokens signed with the Supabase JWT secret whose role is
 * `authenticated` or `service_role`; it keeps `sub` only for logging). Used
 * where there is no user session to forward: the guest import preview
 * (lib/import/preview.ts) and the public API (lib/api/compile.ts).
 *
 * Server-only by construction: callers are route handlers and server modules.
 */

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * A short-lived HS256 token for the compile service, which accepts any token
 * signed with the Supabase project's JWT secret (services/compile/main.go
 * `jwtAuthMiddleware`; no claim checks). Same shape as the one
 * tools/scripts/compile-templates.mjs mints.
 */
export function mintCompileServiceToken(secret: string, now = Date.now(), ttlSeconds = 120): string {
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iss: 'octree-app', sub: 'import-preview', role: 'service_role', iat, exp: iat + ttlSeconds })
  );
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Credential for the compile service when there is no user session.
 * `SUPABASE_JWT_SECRET` (if the app has it) mints a 2-minute token; otherwise
 * the Supabase service-role key is used, which is itself an HS256 JWT signed
 * with that secret and is what the ops compile smoke test
 * (app/api/cron/health-check) already sends. Never a user's session.
 */
export interface CompileCredentialEnv {
  SUPABASE_JWT_SECRET?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export function compileServiceToken(
  env: CompileCredentialEnv = process.env as CompileCredentialEnv,
  now = Date.now()
): string | null {
  if (env.SUPABASE_JWT_SECRET) return mintCompileServiceToken(env.SUPABASE_JWT_SECRET, now);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (key && key.startsWith('ey')) return key;
  return null;
}

