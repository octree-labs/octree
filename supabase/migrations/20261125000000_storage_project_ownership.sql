-- Scope storage access to the owner of the data.
--
-- Before this migration the four `octree` policies for `projects/**` only
-- checked the bucket and the first folder, so any signed-in user could list,
-- read, write or delete objects under any project. They now require that the
-- project named by the path belongs to the caller:
--
--   projects/<project id>/<path>          project files
--   projects/_previews/<project id>.jpg   dashboard thumbnail
--                                         (lib/utils/project-preview-path.ts)
--
-- `chat-attachments` had the same shape: any signed-in user could upload
-- anywhere in the bucket and anyone (including anon) could list it. Objects
-- there are written as `<user id>/<document id>/<file>` (hooks/use-generate.ts
-- uploadFilesToStorage), so insert and select are scoped to the user's folder.
--
-- The temp-imports policies (`temp-imports/<user id>/**`) are already scoped
-- to auth.uid() and are left as they are.
--
-- Not changed here: both buckets are `public = true`, so the public object
-- URL (/storage/v1/object/public/...) still serves any object to whoever has
-- its path. Making the buckets private is a separate change.
--
-- The service role bypasses RLS, so server code using createAdminClient()
-- (delete-account, import previews) is unaffected.
--
-- Ordering consequence for app code: a user can only touch
-- projects/<id>/... while the `projects` row exists and is theirs. Every
-- create path inserts the row before uploading, and every delete path removes
-- the objects before the row.
--
-- Idempotent: every policy is dropped if it exists and recreated, and the
-- index is created if missing.
--
-- Read-only checks to run in the SQL editor after applying:
--
--   -- 1. The octree projects/ policies now reference public.projects:
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--   order by policyname;
--
--   -- 2. No storage.objects policy is left that grants a bucket without an
--   --    owner check (expect zero rows):
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and coalesce(qual, '') || coalesce(with_check, '') not like '%auth.uid()%';
--
--   -- 3. The supporting index exists:
--   select indexname, indexdef from pg_indexes
--   where schemaname = 'public' and tablename = 'projects';
--
--   -- 4. Project objects whose folder is not an existing project (these
--   --    become unreachable for users; the service role still sees them):
--   select count(*) from storage.objects o
--   where o.bucket_id = 'octree'
--     and (storage.foldername(o.name))[1] = 'projects'
--     and (storage.foldername(o.name))[2] <> '_previews'
--     and not exists (
--       select 1 from public.projects p
--       where p.id::text = (storage.foldername(o.name))[2]
--     );
--
--   -- 5. Plan of the ownership lookup for one user (replace the uuids):
--   explain select 1 from public.projects p
--   where p.user_id = '00000000-0000-0000-0000-000000000000'
--     and p.id::text = '00000000-0000-0000-0000-000000000000';

-- The policy lookup filters projects by user_id (the `p.id::text = ...`
-- comparison cannot use the primary key index on id). projects RLS filters on
-- user_id too, and the table had no index on it.
create index if not exists projects_user_id_idx on public.projects (user_id);

-- octree/projects/** — project files and previews, owner only.
-- `(select auth.uid())` is evaluated once per statement instead of per row.

drop policy if exists "Allow authenticated users to access files 1i4k60i_0" on storage.objects;
drop policy if exists "Owners can read their project files" on storage.objects;
create policy "Owners can read their project files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'octree'
    and (storage.foldername(name))[1] = 'projects'
    and exists (
      select 1 from public.projects p
      where p.user_id = (select auth.uid())
        and p.id::text = case
          when (storage.foldername(name))[2] = '_previews'
            then regexp_replace(storage.filename(name), '\.jpg$', '')
          else (storage.foldername(name))[2]
        end
    )
  );

drop policy if exists "Allow authenticated users to access files 1i4k60i_1" on storage.objects;
drop policy if exists "Owners can upload their project files" on storage.objects;
create policy "Owners can upload their project files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'octree'
    and (storage.foldername(name))[1] = 'projects'
    and exists (
      select 1 from public.projects p
      where p.user_id = (select auth.uid())
        and p.id::text = case
          when (storage.foldername(name))[2] = '_previews'
            then regexp_replace(storage.filename(name), '\.jpg$', '')
          else (storage.foldername(name))[2]
        end
    )
  );

-- UPDATE (upsert overwrite, move/rename): `using` applies to the existing
-- object and `with check` to the new name, so a move into another user's
-- project is refused as well.
drop policy if exists "Allow authenticated users to access files 1i4k60i_2" on storage.objects;
drop policy if exists "Owners can update their project files" on storage.objects;
create policy "Owners can update their project files" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'octree'
    and (storage.foldername(name))[1] = 'projects'
    and exists (
      select 1 from public.projects p
      where p.user_id = (select auth.uid())
        and p.id::text = case
          when (storage.foldername(name))[2] = '_previews'
            then regexp_replace(storage.filename(name), '\.jpg$', '')
          else (storage.foldername(name))[2]
        end
    )
  )
  with check (
    bucket_id = 'octree'
    and (storage.foldername(name))[1] = 'projects'
    and exists (
      select 1 from public.projects p
      where p.user_id = (select auth.uid())
        and p.id::text = case
          when (storage.foldername(name))[2] = '_previews'
            then regexp_replace(storage.filename(name), '\.jpg$', '')
          else (storage.foldername(name))[2]
        end
    )
  );

drop policy if exists "Allow authenticated users to access files 1i4k60i_3" on storage.objects;
drop policy if exists "Owners can delete their project files" on storage.objects;
create policy "Owners can delete their project files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'octree'
    and (storage.foldername(name))[1] = 'projects'
    and exists (
      select 1 from public.projects p
      where p.user_id = (select auth.uid())
        and p.id::text = case
          when (storage.foldername(name))[2] = '_previews'
            then regexp_replace(storage.filename(name), '\.jpg$', '')
          else (storage.foldername(name))[2]
        end
    )
  );

-- chat-attachments/<user id>/** — owner only. Displayed through the bucket's
-- public URL, which does not go through these policies.

drop policy if exists "Allow authenticated upload to chat-attachments" on storage.objects;
drop policy if exists "Users can upload their own chat-attachments" on storage.objects;
create policy "Users can upload their own chat-attachments" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Allow public read on chat-attachments" on storage.objects;
drop policy if exists "Users can read their own chat-attachments" on storage.objects;
create policy "Users can read their own chat-attachments" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
