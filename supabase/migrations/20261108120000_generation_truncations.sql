-- Generation truncations (app/api/generate-document).
--
-- One row each time a generation by a free / credit user is cut off before
-- `\end{document}` (max_tokens or the route's 740 s deadline). The route
-- hands the free generation / credit back for at most 2 of these per user
-- per rolling 24 hours; without a cap a free user could ask for documents
-- longer than one generation can write, again and again, and get each one
-- refunded.
--
-- Why a table of its own and not generated_documents.error: users can
-- update and delete their own generated_documents rows (RLS), so a counter
-- kept there could be reset with one PATCH, and a document can be cut off
-- more than once across follow-ups while it is still one row.
--
-- Service role only: no grants to anon / authenticated, so a user can
-- neither read nor clear their count. created_at always comes from the
-- default. Re-running this file is safe. It does not touch user_usage.

create table if not exists public.generation_truncations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'free' or 'credit': what was consumed for the generation.
  kind text not null check (kind in ('free', 'credit')),
  created_at timestamptz not null default now()
);

create index if not exists generation_truncations_user_id_created_at_idx
  on public.generation_truncations (user_id, created_at desc);

alter table public.generation_truncations enable row level security;

revoke all on table public.generation_truncations from public, anon, authenticated;
grant all on table public.generation_truncations to service_role;
