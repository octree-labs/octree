'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseBibtexEntries } from '@/lib/citations/parse-bibtex';
import { generateBibtex } from '@/lib/zotero/bibtex';
import { fetchZoteroPublicEntries } from '@/lib/zotero/fetch-public';
import { parseZoteroSourceUrl } from '@/lib/zotero/parse-source';
import { createClient } from '@/lib/supabase/client';
import type { CitationEntry, ZoteroLocalState } from '@/types/citation';

const ZOTERO_EVENT = 'octree:zotero:updated';

const defaultState = (sourceUrl = ''): ZoteroLocalState => ({
  sourceUrl,
  ownerType: 'user',
  ownerId: '',
  collectionKey: null,
  lastSyncedAt: null,
  lastSyncStatus: 'never',
  lastSyncError: null,
  entries: [],
  refsBib: '',
});

function normalizeRow(row: Record<string, unknown> | null): ZoteroLocalState {
  if (!row) return defaultState();

  const sourceUrl = typeof row.source_url === 'string' ? row.source_url : '';
  const ownerType = row.owner_type === 'group' ? 'group' : 'user';
  const ownerId = typeof row.owner_id === 'string' ? row.owner_id : '';
  const collectionKey =
    typeof row.collection_key === 'string' ? row.collection_key : null;
  const lastSyncedAt =
    typeof row.last_synced_at === 'string' ? row.last_synced_at : null;
  const lastSyncStatus =
    row.last_sync_status === 'ok' || row.last_sync_status === 'error'
      ? row.last_sync_status
      : 'never';
  const lastSyncError =
    typeof row.last_sync_error === 'string' ? row.last_sync_error : null;
  const refsBib = typeof row.refs_bib === 'string' ? row.refs_bib : '';

  let entries: CitationEntry[] = [];
  if (Array.isArray(row.entries)) {
    entries = row.entries as CitationEntry[];
  } else if (refsBib) {
    entries = parseBibtexEntries(refsBib);
  }

  return {
    sourceUrl,
    ownerType,
    ownerId,
    collectionKey,
    lastSyncedAt,
    lastSyncStatus,
    lastSyncError,
    entries,
    refsBib,
  };
}

function emitUpdate(projectId: string) {
  window.dispatchEvent(
    new CustomEvent(ZOTERO_EVENT, {
      detail: { projectId },
    })
  );
}

export function searchCitationEntries(
  entries: CitationEntry[],
  query: string
): CitationEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return entries;

  return entries.filter((entry) => {
    const haystack =
      `${entry.key} ${entry.title} ${entry.author} ${entry.year}`.toLowerCase();
    return haystack.includes(trimmed);
  });
}

export function useZoteroSync(projectId: string) {
  const [state, setState] = useState<ZoteroLocalState>(defaultState());
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    if (!projectId) return;

    const supabase = createClient() as any;
    const { data } = await supabase
      .from('project_zotero_sources')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    setState(normalizeRow(data as Record<string, unknown> | null));
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const onCustomUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (!detail?.projectId || detail.projectId === projectId) {
        reload();
      }
    };

    window.addEventListener(ZOTERO_EVENT, onCustomUpdate);
    return () => {
      window.removeEventListener(ZOTERO_EVENT, onCustomUpdate);
    };
  }, [projectId, reload]);

  const persistState = useCallback(
    async (next: ZoteroLocalState): Promise<ZoteroLocalState> => {
      const supabase = createClient() as any;
      const { data, error } = await supabase
        .from('project_zotero_sources')
        .upsert(
          {
            project_id: projectId,
            source_url: next.sourceUrl,
            owner_type: next.ownerType,
            owner_id: next.ownerId,
            collection_key: next.collectionKey,
            last_synced_at: next.lastSyncedAt,
            last_sync_status: next.lastSyncStatus,
            last_sync_error: next.lastSyncError,
            entries: next.entries,
            refs_bib: next.refsBib,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'project_id' }
        )
        .select('*')
        .single();

      if (error) throw new Error('Failed to persist Zotero integration state');

      const normalized = normalizeRow(data as Record<string, unknown>);
      setState(normalized);
      emitUpdate(projectId);
      return normalized;
    },
    [projectId]
  );

  const syncFromUrl = useCallback(
    async (sourceUrl: string): Promise<ZoteroLocalState> => {
      if (!projectId) {
        throw new Error('Missing project context');
      }

      const parsedSource = parseZoteroSourceUrl(sourceUrl);
      setSyncing(true);
      try {
        const entries = await fetchZoteroPublicEntries(parsedSource);
        return await persistState({
          ...parsedSource,
          lastSyncedAt: new Date().toISOString(),
          lastSyncStatus: 'ok',
          lastSyncError: null,
          entries,
          refsBib: generateBibtex(entries),
        });
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'Failed to sync Zotero references';
        await persistState({
          ...state,
          ...parsedSource,
          sourceUrl: parsedSource.sourceUrl,
          lastSyncStatus: 'error',
          lastSyncError: message,
        });
        throw error instanceof Error ? error : new Error(message);
      } finally {
        setSyncing(false);
      }
    },
    [projectId, state, persistState]
  );

  const syncSaved = useCallback(async (): Promise<ZoteroLocalState> => {
    if (!state.sourceUrl) {
      throw new Error('Add a Zotero URL first');
    }
    return syncFromUrl(state.sourceUrl);
  }, [state.sourceUrl, syncFromUrl]);

  const searchEntries = useCallback(
    (query: string) => searchCitationEntries(state.entries, query),
    [state.entries]
  );

  return useMemo(
    () => ({
      state,
      syncing,
      reload,
      syncFromUrl,
      syncSaved,
      searchEntries,
    }),
    [state, syncing, reload, syncFromUrl, syncSaved, searchEntries]
  );
}
