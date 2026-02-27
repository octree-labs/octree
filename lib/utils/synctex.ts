import { createClient } from '@/lib/supabase/client';

const COMPILE_SERVICE_URL = process.env.NEXT_PUBLIC_COMPILE_SERVICE_URL;

export interface SynctexForwardResult {
  page: number;
  h: number;
  v: number;
  w: number;
  height: number;
}

export interface SynctexReverseResult {
  file: string;
  line: number;
  column: number;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return headers;
}

export async function synctexForward(
  projectId: string,
  file: string,
  line: number,
  column: number
): Promise<SynctexForwardResult[]> {
  if (!COMPILE_SERVICE_URL) {
    throw new Error('NEXT_PUBLIC_COMPILE_SERVICE_URL is not configured');
  }

  const headers = await getAuthHeaders();
  const response = await fetch(`${COMPILE_SERVICE_URL}/synctex`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId,
      direction: 'forward',
      file,
      line,
      column,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'SyncTeX forward lookup failed');
  }

  const data = await response.json();
  return data.pdfPositions ?? [];
}

export async function synctexReverse(
  projectId: string,
  page: number,
  h: number,
  v: number
): Promise<SynctexReverseResult | null> {
  if (!COMPILE_SERVICE_URL) {
    throw new Error('NEXT_PUBLIC_COMPILE_SERVICE_URL is not configured');
  }

  const headers = await getAuthHeaders();
  const response = await fetch(`${COMPILE_SERVICE_URL}/synctex`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId,
      direction: 'reverse',
      page,
      h,
      v,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'SyncTeX reverse lookup failed');
  }

  const data = await response.json();
  const positions: SynctexReverseResult[] = data.codePositions ?? [];
  return positions[0] ?? null;
}
