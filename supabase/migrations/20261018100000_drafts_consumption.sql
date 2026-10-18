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

-- The import route marks the draft consumed with the user's own session. The
-- baseline only has insert/select/delete policies (all USING (true)) and
-- GRANT ALL, so an UPDATE policy alone would let any signed-in user rewrite
-- the content/title of any unconsumed draft. Restrict UPDATE to the three
-- consumption columns at the privilege level, then let an unconsumed draft be
-- claimed exactly once, only by the caller, and only into their own project.
revoke update on public.drafts from anon, authenticated;
grant update (consumed_at, consumed_by, project_id) on public.drafts to authenticated;

drop policy if exists drafts_update_consume on public.drafts;
create policy drafts_update_consume on public.drafts
  for update to authenticated
  using (consumed_at is null)
  with check (
    consumed_at is not null
    and consumed_by = auth.uid()
    and (
      project_id is null
      or exists (
        select 1 from public.projects p
        where p.id = project_id and p.user_id = auth.uid()
      )
    )
  );

-- Nothing in the app deletes drafts any more (the import route updates them),
-- and the baseline delete policy let anyone, including anon, wipe the table
-- and with it the funnel numbers. Service role is unaffected.
drop policy if exists drafts_delete_any on public.drafts;
revoke delete on public.drafts from anon, authenticated;
