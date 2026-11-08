import { apiPreflight, CORS_HEADERS } from '@/lib/api/http';
import { openApiDocument } from '@/lib/api/openapi';

/** GET /api/v1/openapi.json: OpenAPI 3.1 description of the public API. Public. */

export const dynamic = 'force-static';

export async function OPTIONS() {
  return apiPreflight();
}

export async function GET() {
  return new Response(JSON.stringify(openApiDocument, null, 2), {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
