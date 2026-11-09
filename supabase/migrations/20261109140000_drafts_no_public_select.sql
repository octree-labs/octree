-- "Open in Octree" drafts are capability-based: whoever holds a draft's uuid
-- may open that one draft, nothing else. The baseline policy
-- drafts_select_any (TO anon, authenticated USING (true)) plus GRANT ALL let
-- anyone with the public key list every draft (content, title, source) via
-- PostgREST, e.g. GET /rest/v1/drafts?select=*.
--
-- Every read and write of `drafts` is server-side and now goes through the
-- service role (lib/supabase/admin.ts), which bypasses RLS:
--   - POST /api/drafts and /api/sso insert drafts,
--   - /import/start and /api/import/preview read one draft by id,
--   - /import reads and consumes the draft (consumed_at IS NULL guard, the
--     project is created with the user's own session),
--   - the daily digest counts rows.
-- So anon and authenticated get no access at all: no policies, no grants.
-- RLS stays enabled as a second line of defence.
--
-- Deploy the app before applying this (older builds still use the session
-- client for drafts and would lose access). Idempotent.

drop policy if exists drafts_select_any on public.drafts;
drop policy if exists drafts_insert_any on public.drafts;
drop policy if exists drafts_delete_any on public.drafts;
drop policy if exists drafts_update_consume on public.drafts;

alter table public.drafts enable row level security;

-- Column-level UPDATE was granted by 20261018100000_drafts_consumption; revoke
-- it explicitly as well as every table-level privilege.
revoke update (consumed_at, consumed_by, project_id) on public.drafts from anon, authenticated;
revoke all on table public.drafts from anon, authenticated;

grant all on table public.drafts to service_role;
