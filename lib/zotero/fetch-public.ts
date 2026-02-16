import type { CitationEntry, ZoteroSourceInfo } from '@/types/citation';

interface ZoteroCreator {
  firstName?: string;
  lastName?: string;
  name?: string;
}

interface ZoteroItemData {
  title?: string;
  date?: string;
  creators?: ZoteroCreator[];
  publicationTitle?: string;
  bookTitle?: string;
  proceedingsTitle?: string;
  itemType?: string;
}

interface ZoteroItem {
  key: string;
  data?: ZoteroItemData;
}

function parseYear(date: string | undefined): string {
  if (!date) return 'n.d.';
  const match = date.match(/\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\b/);
  return match ? match[1] : 'n.d.';
}

function formatCreators(creators: ZoteroCreator[] | undefined): string {
  if (!creators || creators.length === 0) return 'Unknown';

  const names = creators
    .slice(0, 3)
    .map((creator) => {
      if (creator.name) return creator.name;
      const first = creator.firstName?.trim() ?? '';
      const last = creator.lastName?.trim() ?? '';
      return `${first} ${last}`.trim();
    })
    .filter(Boolean);

  if (names.length === 0) return 'Unknown';
  if (creators.length > 3) return `${names.join(', ')} et al.`;
  return names.join(', ');
}

function toCitationEntry(item: ZoteroItem): CitationEntry {
  const data = item.data ?? {};
  return {
    key: item.key,
    title: data.title?.trim() || 'Untitled',
    author: formatCreators(data.creators),
    year: parseYear(data.date),
    source:
      data.publicationTitle?.trim() ||
      data.bookTitle?.trim() ||
      data.proceedingsTitle?.trim() ||
      undefined,
    itemType: data.itemType,
  };
}

function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(',');
  for (const part of parts) {
    if (part.includes('rel="next"')) {
      const match = part.match(/<([^>]+)>/);
      if (match) return match[1];
    }
  }
  return null;
}

function dedupeByKey(entries: CitationEntry[]): CitationEntry[] {
  const byKey = new Map<string, CitationEntry>();
  for (const entry of entries) {
    if (!byKey.has(entry.key)) {
      byKey.set(entry.key, entry);
    }
  }
  return Array.from(byKey.values());
}

function isNumeric(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

interface ZoteroUserLookup {
  userID?: number | string;
  username?: string;
}

async function resolveUserIdByUsername(username: string): Promise<string> {
  const lookupUrl = `https://api.zotero.org/users?q=${encodeURIComponent(username)}`;
  let response: Response;
  try {
    response = await fetch(lookupUrl, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error(
      'Unable to reach Zotero API. Check network access and browser CORS restrictions.'
    );
  }

  if (!response.ok) {
    throw new Error(`Failed to resolve Zotero username (${response.status})`);
  }

  let users: ZoteroUserLookup[];
  try {
    users = (await response.json()) as ZoteroUserLookup[];
  } catch {
    throw new Error('Zotero user lookup returned malformed data');
  }

  if (!Array.isArray(users) || users.length === 0) {
    throw new Error('No Zotero user found for this username');
  }

  const exactMatch = users.find(
    (user) =>
      typeof user.username === 'string' &&
      user.username.toLowerCase() === username.toLowerCase()
  );

  const chosen = exactMatch ?? users[0];
  const userId = chosen.userID;
  if (!userId) {
    throw new Error('Could not determine Zotero user id from username');
  }

  return String(userId);
}

export function getZoteroItemsApiUrl(source: ZoteroSourceInfo): string {
  const base =
    source.ownerType === 'user'
      ? `https://api.zotero.org/users/${encodeURIComponent(source.ownerId)}`
      : `https://api.zotero.org/groups/${encodeURIComponent(source.ownerId)}`;

  if (source.collectionKey) {
    return `${base}/collections/${encodeURIComponent(source.collectionKey)}/items?format=json&limit=100`;
  }

  return `${base}/items?format=json&limit=100`;
}

export async function fetchZoteroPublicEntries(
  source: ZoteroSourceInfo
): Promise<CitationEntry[]> {
  let resolvedSource = source;
  if (source.ownerType === 'user' && !isNumeric(source.ownerId)) {
    const numericUserId = await resolveUserIdByUsername(source.ownerId);
    resolvedSource = { ...source, ownerId: numericUserId };
  }

  let url: string | null = getZoteroItemsApiUrl(resolvedSource);
  const allItems: ZoteroItem[] = [];
  let pages = 0;

  while (url && pages < 10) {
    pages += 1;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
      });
    } catch {
      throw new Error(
        'Failed to fetch Zotero references. Verify your library is public and your browser/network allows api.zotero.org requests.'
      );
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch Zotero references (${response.status})`);
    }

    let items: ZoteroItem[];
    try {
      items = (await response.json()) as ZoteroItem[];
    } catch {
      throw new Error('Received malformed response from Zotero');
    }

    if (!Array.isArray(items)) {
      throw new Error('Received malformed response from Zotero');
    }

    allItems.push(...items.filter((item) => item?.key));
    url = nextPageUrl(response.headers.get('link'));
  }

  const entries = allItems.map(toCitationEntry);
  return dedupeByKey(entries);
}
