export interface CitationEntry {
  key: string;
  title: string;
  author: string;
  year: string;
  source?: string;
  itemType?: string;
}

export type ZoteroOwnerType = 'user' | 'group';

export interface ZoteroSourceInfo {
  sourceUrl: string;
  ownerType: ZoteroOwnerType;
  ownerId: string;
  collectionKey: string | null;
}

export type ZoteroSyncStatus = 'never' | 'ok' | 'error';

export interface ZoteroLocalState extends ZoteroSourceInfo {
  lastSyncedAt: string | null;
  lastSyncStatus: ZoteroSyncStatus;
  lastSyncError: string | null;
  entries: CitationEntry[];
  refsBib: string;
}

