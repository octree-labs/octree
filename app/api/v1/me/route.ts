import { authenticateApiRequest } from '@/lib/api/auth';
import { getApiUsage } from '@/lib/api/compile';
import { apiJson, apiPreflight } from '@/lib/api/http';

/** GET /api/v1/me: the key's account, plan and today's compile usage. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return apiPreflight();
}

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  try {
    return apiJson(await getApiUsage(auth.principal));
  } catch (error) {
    console.error('[api/v1/me] failed:', error);
    return apiJson({ error: 'service_unavailable', message: 'Could not read usage. Try again.' }, 503);
  }
}
