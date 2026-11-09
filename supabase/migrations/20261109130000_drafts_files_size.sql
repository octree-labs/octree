-- drafts_files_shape (20261109120000_drafts_files) capped `files::text` at
-- 3 MB, but /api/drafts accepts 2 MB of UTF-8 *content*, and the jsonb text
-- form escapes every backslash, quote and newline (2 bytes each) and control
-- characters (6 bytes each). A backslash-heavy file set the app accepts could
-- therefore fail the check and surface as a 500. The bound only limits direct
-- PostgREST inserts with the anon key, so it is raised to cover the worst
-- escaping of 2 MB (6x) plus the array's own structure.

alter table public.drafts drop constraint if exists drafts_files_shape;

alter table public.drafts
  add constraint drafts_files_shape check (
    files is null
    or (
      jsonb_typeof(files) = 'array'
      and jsonb_array_length(files) between 1 and 50
      and octet_length(files::text) <= 13 * 1024 * 1024
    )
  );
