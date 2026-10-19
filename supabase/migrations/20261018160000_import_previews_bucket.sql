-- Compiled previews of "Open in Octree" drafts for the logged-out landing
-- (/import/start). One object per draft, `<draft id>.pdf` or
-- `<draft id>.error.json`, written and read only by the service role from
-- app/api/import/preview/[draftId]. The bucket is private and has no
-- policies on purpose: anon and authenticated never touch it, so the only
-- way to a preview is the route, which refuses consumed and expired drafts.
--
-- Cleanup (not implemented here): objects older than the 7-day draft window
-- can be purged with the drafts they belong to.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('import-previews', 'import-previews', false, 26214400, array['application/pdf', 'application/json'])
on conflict (id) do nothing;
