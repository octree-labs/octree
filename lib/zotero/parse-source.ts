import type { ZoteroOwnerType, ZoteroSourceInfo } from '@/types/citation';

const ZOTERO_HOSTS = new Set(['zotero.org', 'www.zotero.org']);
const COLLECTION_KEY_PATTERN = /^[A-Z0-9]{8}$/;
const NUMERIC_ID_PATTERN = /^[0-9]+$/;

function normalizeSourceUrl(url: URL): string {
  const normalized = new URL(url.toString());
  normalized.hash = '';
  normalized.search = '';
  return normalized.toString().replace(/\/+$/, '');
}

export function parseZoteroSourceUrl(sourceUrl: string): ZoteroSourceInfo {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl.trim());
  } catch {
    throw new Error('Please enter a valid URL');
  }

  if (!ZOTERO_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Only zotero.org public library URLs are supported');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 1) {
    throw new Error('Unsupported Zotero URL format');
  }

  const scope = segments[0];
  let ownerType: ZoteroOwnerType;
  let ownerId: string;

  if (scope === 'users') {
    ownerId = segments[1] ?? '';
    if (!ownerId) {
      throw new Error('Missing Zotero user id in URL');
    }
    ownerType = 'user';
  } else if (scope === 'groups') {
    ownerId = segments[1] ?? '';
    if (!ownerId) {
      throw new Error('Missing Zotero group id in URL');
    }
    ownerType = 'group';
  } else {
    // Username-style web library URL, e.g. /faizm10/library or /faizm10/items/KEY/item-list
    ownerType = 'user';
    ownerId = scope;
  }

  if (!ownerId.trim()) {
    throw new Error('Missing Zotero owner in URL');
  }

  const ownerLooksNumeric = NUMERIC_ID_PATTERN.test(ownerId);
  if (scope === 'groups' && !ownerLooksNumeric) {
    throw new Error('Group URLs require numeric group id');
  }

  const collectionsIndex = segments.indexOf('collections');
  let collectionKey: string | null = null;
  if (collectionsIndex !== -1) {
    const key = segments[collectionsIndex + 1] ?? '';
    if (!COLLECTION_KEY_PATTERN.test(key)) {
      throw new Error('Invalid Zotero collection key in URL');
    }
    collectionKey = key;
  }

  return {
    sourceUrl: normalizeSourceUrl(parsed),
    ownerType,
    ownerId,
    collectionKey,
  };
}
