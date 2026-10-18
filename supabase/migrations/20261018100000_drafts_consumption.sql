-- "Open in Octree" drafts used to be deleted once they were imported, which
-- made the import funnel unmeasurable (only abandoned drafts survived). Keep
-- every draft and record who consumed it and into which project.
--
-- Rows with consumed_at IS NULL are abandoned imports. Existing rows stay as
-- the baseline. Cleanup (not implemented here): drafts with consumed_at IS NULL
-- older than 90 days can be purged later.

alter table public.drafts
  add column if not exists consumed_at timestamptz,
  add column if not exists consumed_by uuid references auth.users(id) on delete set null,
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists drafts_source_created_at_idx
  on public.drafts (source, created_at);

-- The import route marks the draft consumed with the user's own session.
-- The baseline only has insert/select/delete policies, so add update for
-- signed-in users: an unconsumed draft can be claimed, and only by the caller.
drop policy if exists drafts_update_consume on public.drafts;
create policy drafts_update_consume on public.drafts
  for update to authenticated
  using (consumed_at is null)
  with check (consumed_by = auth.uid());
