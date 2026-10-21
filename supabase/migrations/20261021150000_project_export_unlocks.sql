-- One-off export unlock: $4.99 buys PDF/ZIP export for ONE project, forever,
-- without Pro (plan `export_single`, lib/checkout-plans.ts). Export is the
-- paywall users hit most and nobody bought Pro from it; most of them came
-- for a single document.
--
-- * project_export_unlocks - one row per unlocked project (unique), written
--                            only by the Stripe webhook through
--                            grant_export_unlock. Owners may SELECT their own
--                            rows (the editor reads it with the user's
--                            session); nobody but the service role writes.
-- * grant_export_unlock    - service-role only, called by the webhook. TRUE
--                            when it unlocked, FALSE when the session or the
--                            project was already unlocked (a redelivery, or a
--                            second purchase for the same project).
--
-- The state lives here and not on user_usage, so the user_usage column-guard
-- triggers are untouched. The app tolerates this table being absent until
-- the migration is applied (reads say "locked", the webhook logs and
-- returns). Everything here is idempotent.

create table if not exists public.project_export_unlocks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_session_id text not null unique,
  amount_cents integer not null,
  created_at timestamptz not null default now(),
  unique (project_id)
);

create index if not exists project_export_unlocks_user_id_idx
  on public.project_export_unlocks (user_id);

alter table public.project_export_unlocks enable row level security;

revoke all on table public.project_export_unlocks from public, anon, authenticated;
grant select on table public.project_export_unlocks to authenticated;
grant all on table public.project_export_unlocks to service_role;

drop policy if exists "Owners can read their export unlocks" on public.project_export_unlocks;
create policy "Owners can read their export unlocks"
  on public.project_export_unlocks
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert / update / delete policy: with RLS on, the API roles cannot
-- write; only the service role (which bypasses RLS) and the definer
-- function below can.

-- ---------------------------------------------------------------------------
-- grant_export_unlock(p_user_id, p_project_id, p_session_id, p_amount_cents)
--   -> true (unlocked now) | false (already unlocked, or not the user's project)
--
-- The unique stripe_session_id and unique project_id are the idempotency
-- guard: a Stripe redelivery, or an app retry after a 500, inserts nothing
-- and returns false. The project must belong to p_user_id (the checkout
-- route checked it; this re-checks so a metadata pair that does not match
-- can never unlock someone else's project). Service role only.
-- ---------------------------------------------------------------------------

create or replace function public.grant_export_unlock(
  p_user_id uuid,
  p_project_id uuid,
  p_session_id text,
  p_amount_cents integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_project_id is null then
    raise exception 'grant_export_unlock: p_user_id and p_project_id are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if nullif(p_session_id, '') is null then
    raise exception 'grant_export_unlock: p_session_id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Not (or no longer) the buyer's project: nothing to unlock. FALSE rather
  -- than an error, so Stripe does not retry a delivery that can never
  -- succeed (a project deleted after checkout); the webhook logs it.
  if not exists (
    select 1 from public.projects where id = p_project_id and user_id = p_user_id
  ) then
    return false;
  end if;

  insert into public.project_export_unlocks (project_id, user_id, stripe_session_id, amount_cents)
  values (p_project_id, p_user_id, p_session_id, coalesce(p_amount_cents, 0))
  on conflict do nothing;

  return found;
end;
$$;

revoke execute on function public.grant_export_unlock(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.grant_export_unlock(uuid, uuid, text, integer) to service_role;
