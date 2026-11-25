import { protectedResourceMetadataResponse, protectedResourcePreflight } from '@/lib/oauth/protected-resource-route';

/** RFC 9728 protected resource metadata for the MCP server (lib/oauth/protected-resource-route.ts). */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return protectedResourceMetadataResponse(request);
}

export async function OPTIONS() {
  return protectedResourcePreflight();
}
