create table if not exists public.project_zotero_sources (
  project_id uuid primary key references public.projects(id) on delete cascade,
  source_url text not null,
  owner_type text not null check (owner_type in ('user', 'group')),
  owner_id text not null,
  collection_key text,
  last_synced_at timestamptz,
  last_sync_status text not null default 'never' check (last_sync_status in ('never', 'ok', 'error')),
  last_sync_error text,
  entries jsonb not null default '[]'::jsonb,
  refs_bib text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_zotero_sources_updated_at_idx
  on public.project_zotero_sources(updated_at desc);

alter table public.project_zotero_sources enable row level security;

create policy "Users can view zotero sources on owned/collab projects"
  on public.project_zotero_sources
  for select
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_zotero_sources.project_id
        and p.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.project_collaborators pc
      where pc.project_id = project_zotero_sources.project_id
        and pc.user_id = auth.uid()
    )
  );

create policy "Users can insert zotero sources on owned/collab projects"
  on public.project_zotero_sources
  for insert
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = project_zotero_sources.project_id
        and p.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.project_collaborators pc
      where pc.project_id = project_zotero_sources.project_id
        and pc.user_id = auth.uid()
    )
  );

create policy "Users can update zotero sources on owned/collab projects"
  on public.project_zotero_sources
  for update
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_zotero_sources.project_id
        and p.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.project_collaborators pc
      where pc.project_id = project_zotero_sources.project_id
        and pc.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = project_zotero_sources.project_id
        and p.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.project_collaborators pc
      where pc.project_id = project_zotero_sources.project_id
        and pc.user_id = auth.uid()
    )
  );

create policy "Users can delete zotero sources on owned/collab projects"
  on public.project_zotero_sources
  for delete
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_zotero_sources.project_id
        and p.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.project_collaborators pc
      where pc.project_id = project_zotero_sources.project_id
        and pc.user_id = auth.uid()
    )
  );

