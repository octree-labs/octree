-- Make the `octree` and `chat-attachments` buckets private.
--
-- 20261125000000_storage_project_ownership scoped storage.objects RLS to the
-- owner, but a public bucket serves every object through
-- /storage/v1/object/public/<bucket>/<path> without consulting RLS. With
-- `public = false` every read goes through RLS: the app reads objects with
-- authenticated downloads and shows images through short-lived signed URLs
-- (lib/storage/signed-urls.ts), which only the owner can create.
--
-- Rollout: deploy the app code that stops using public URLs first (it works
-- with public and private buckets), then apply this migration. Public URLs
-- stored on older rows (files.url, generated_documents.attachments and
-- message_history) stop resolving; the app derives the object path from them
-- and signs it instead.
--
-- Not changed here: the `artifacts` and `projects-test` buckets, which no app
-- code references.
--
-- Idempotent: setting the flag again is a no-op.
--
-- Read-only checks to run in the SQL editor after applying:
--
--   -- 1. Both buckets are private (expect public = false on both rows):
--   select id, public from storage.buckets
--   where id in ('octree', 'chat-attachments');
--
--   -- 2. Every bucket that is still public (review the list):
--   select id, public, created_at from storage.buckets
--   where public order by id;
--
--   -- 3. Rows that still hold a public URL (served from the derived path now):
--   select count(*) from public.files where url like '%/storage/v1/object/public/%';
--   select count(*) from public.generated_documents
--   where attachments::text like '%/storage/v1/object/public/%'
--      or message_history::text like '%/storage/v1/object/public/%';

update storage.buckets
set public = false
where id in ('octree', 'chat-attachments')
  and public;
