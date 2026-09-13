-- Objects that live outside the `public` schema and so were missing from the
-- baseline dump (`supabase db dump` covers public only). Without these a fresh
-- local stack has no user_usage rows on signup and no storage buckets.
--
-- All statements are idempotent: this is a no-op against prod, where these
-- objects already exist.

-- Creates the user_usage row for every new signup.
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into storage.buckets (id, name, public)
values ('octree', 'octree', true),
       ('chat-attachments', 'chat-attachments', true)
on conflict (id) do nothing;

-- octree/projects/** — project files
drop policy if exists "Allow authenticated users to access files 1i4k60i_0" on storage.objects;
create policy "Allow authenticated users to access files 1i4k60i_0" on storage.objects
  for select to authenticated
  using (bucket_id = 'octree' and (storage.foldername(name))[1] = 'projects');

drop policy if exists "Allow authenticated users to access files 1i4k60i_1" on storage.objects;
create policy "Allow authenticated users to access files 1i4k60i_1" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'octree' and (storage.foldername(name))[1] = 'projects');

drop policy if exists "Allow authenticated users to access files 1i4k60i_2" on storage.objects;
create policy "Allow authenticated users to access files 1i4k60i_2" on storage.objects
  for update to authenticated
  using (bucket_id = 'octree' and (storage.foldername(name))[1] = 'projects');

drop policy if exists "Allow authenticated users to access files 1i4k60i_3" on storage.objects;
create policy "Allow authenticated users to access files 1i4k60i_3" on storage.objects
  for delete to authenticated
  using (bucket_id = 'octree' and (storage.foldername(name))[1] = 'projects');

-- octree/temp-imports/<uid>/** — LaTeX import staging
drop policy if exists "Users can upload to their own temp-imports folder" on storage.objects;
create policy "Users can upload to their own temp-imports folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'octree'
    and (storage.foldername(name))[1] = 'temp-imports'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Users can read their own temp-imports files" on storage.objects;
create policy "Users can read their own temp-imports files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'octree'
    and (storage.foldername(name))[1] = 'temp-imports'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Users can delete their own temp-imports files" on storage.objects;
create policy "Users can delete their own temp-imports files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'octree'
    and (storage.foldername(name))[1] = 'temp-imports'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- chat-attachments/<uid>/**
drop policy if exists "Allow authenticated upload to chat-attachments" on storage.objects;
create policy "Allow authenticated upload to chat-attachments" on storage.objects
  for insert to public
  with check (bucket_id = 'chat-attachments' and auth.role() = 'authenticated');

drop policy if exists "Allow public read on chat-attachments" on storage.objects;
create policy "Allow public read on chat-attachments" on storage.objects
  for select to public
  using (bucket_id = 'chat-attachments');

drop policy if exists "Allow users to delete own chat-attachments" on storage.objects;
create policy "Allow users to delete own chat-attachments" on storage.objects
  for delete to public
  using (
    bucket_id = 'chat-attachments'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
