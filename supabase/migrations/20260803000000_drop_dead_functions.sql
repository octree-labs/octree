-- Drop functions left over from the removed documents/collaborators feature.
-- The first four reference tables that no longer exist (documents, document_versions,
-- document_collaborators, profiles, project_collaborators); is_project_owner is valid
-- but unreferenced by any policy, trigger, or .rpc() call.

drop function if exists public.create_document_version();
drop function if exists public.get_document_with_collaborators(uuid);
drop function if exists public.get_user_collab_project_ids();
drop function if exists public.has_project_access(uuid, uuid);
drop function if exists public.is_project_owner(uuid);
