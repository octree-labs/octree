-- Multi-file "Open in Octree" drafts. tools.useoctree.com can now post a
-- whole project (main .tex plus .bib/.cls/.sty/sub-.tex files) instead of one
-- flattened file. The files are stored as a JSON array of
-- { "path": "<relative path>", "content": "<text>" } objects, main file
-- first; `content` keeps holding the main file so every reader of the
-- single-file shape keeps working. NULL = a single-file draft (all existing rows).
--
-- Access: the baseline grants anon/authenticated INSERT and SELECT on the
-- whole table (drafts_insert_any / drafts_select_any), which covers the new
-- column; UPDATE stays restricted to the three consumption columns
-- (20261018100000_drafts_consumption), so nobody can rewrite `files` after
-- the fact. The guest preview reads drafts with the service role.
--
-- The app validates paths and caps (<= 50 files, <= 2 MB) in /api/drafts and
-- re-validates on read; the checks below only bound what a direct PostgREST
-- insert with the public anon key can store.

alter table public.drafts
  add column if not exists files jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'drafts_files_shape' and conrelid = 'public.drafts'::regclass
  ) then
    alter table public.drafts
      add constraint drafts_files_shape check (
        files is null
        or (
          jsonb_typeof(files) = 'array'
          and jsonb_array_length(files) between 1 and 50
          and octet_length(files::text) <= 3 * 1024 * 1024
        )
      );
  end if;
end
$$;
