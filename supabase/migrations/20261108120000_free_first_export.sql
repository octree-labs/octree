-- Free first export: every account's first PDF/ZIP export is free; from the
-- second one on, the existing paywall (Pro, or the $4.99 `export_single`
-- unlock of one project) applies.
--
-- The free export is recorded as a project_export_unlocks row with
-- source = 'free_first' (no Stripe session, amount 0): the project it was
-- used on stays exportable forever, exactly like a bought unlock, and the
-- app reads both through the same lookup (lib/export-unlock.ts).
--
-- * project_export_unlocks.source  - 'purchase' (the Stripe webhook, every
--                                    existing row) or 'free_first'. Nullable
--                                    with a default; NULL reads as 'purchase'.
-- * stripe_session_id              - nullable now, but required for a
--                                    purchase (check constraint).
-- * one free_first row per user    - partial unique index; the race guard.
-- * project_id on delete set null  - the free_first row survives deleting
--                                    its project (else: delete, claim again).
-- * claim_free_first_export        - service-role only, called by the server
--                                    action (actions/claim-free-export.ts).
--
-- Nothing here touches user_usage or its column-guard triggers. The app
-- tolerates this migration being absent (no free export; the paywall shows
-- as before). Everything is idempotent.

alter table public.project_export_unlocks
  add column if not exists source text;

update public.project_export_unlocks set source = 'purchase' where source is null;

alter table public.project_export_unlocks
  alter column source set default 'purchase';

alter table public.project_export_unlocks
  alter column stripe_session_id drop not null;

alter table public.project_export_unlocks
  drop constraint if exists project_export_unlocks_source_check;
alter table public.project_export_unlocks
  add constraint project_export_unlocks_source_check
  check (
    (source is null or source in ('purchase', 'free_first'))
    and (source = 'free_first' or stripe_session_id is not null)
  );

-- The free export must outlive the project it was used on: with the
-- original `on delete cascade`, deleting that project deleted the
-- free_first row and the partial unique index below no longer saw it, so
-- the user could claim again (claim, export, delete, repeat). project_id
-- becomes nullable and the foreign key `on delete set null`: the row stays
-- (keyed by user_id), and a bought unlock's row also survives its project
-- (refund / accounting trail). unique (project_id) allows any number of NULLs.
alter table public.project_export_unlocks
  alter column project_id drop not null;

do $$
declare
  fk text;
begin
  for fk in
    select conname from pg_constraint
    where conrelid = 'public.project_export_unlocks'::regclass
      and contype = 'f'
      and confrelid = 'public.projects'::regclass
      and confdeltype <> 'n'
  loop
    execute format('alter table public.project_export_unlocks drop constraint %I', fk);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.project_export_unlocks'::regclass
      and contype = 'f'
      and confrelid = 'public.projects'::regclass
  ) then
    alter table public.project_export_unlocks
      add constraint project_export_unlocks_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete set null;
  end if;
end;
$$;

create unique index if not exists project_export_unlocks_free_first_user_idx
  on public.project_export_unlocks (user_id)
  where source = 'free_first';

-- ---------------------------------------------------------------------------
-- claim_free_first_export(p_user_id, p_project_id) -> text
--   'granted'          the free export was used on this project now
--   'already_unlocked' the project was already unlocked (free or bought)
--   'used'             the user already used their free export elsewhere
--   'not_found'        not the user's project
--
-- The unique project_id and the partial unique index on free_first rows make
-- two concurrent claims grant at most once. Entitlement (Pro, allowlist) is
-- the caller's check: a Pro user never reaches this.
-- ---------------------------------------------------------------------------

create or replace function public.claim_free_first_export(
  p_user_id uuid,
  p_project_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_project_id is null then
    raise exception 'claim_free_first_export: p_user_id and p_project_id are required'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1 from public.projects where id = p_project_id and user_id = p_user_id
  ) then
    return 'not_found';
  end if;

  if exists (select 1 from public.project_export_unlocks where project_id = p_project_id) then
    return 'already_unlocked';
  end if;

  if exists (
    select 1 from public.project_export_unlocks
    where user_id = p_user_id and source = 'free_first'
  ) then
    return 'used';
  end if;

  insert into public.project_export_unlocks (project_id, user_id, stripe_session_id, amount_cents, source)
  values (p_project_id, p_user_id, null, 0, 'free_first')
  on conflict do nothing;

  if found then
    return 'granted';
  end if;

  -- Lost a race: another request unlocked this project, or used the free
  -- export on another project, between the checks and the insert.
  if exists (select 1 from public.project_export_unlocks where project_id = p_project_id) then
    return 'already_unlocked';
  end if;
  return 'used';
end;
$$;

revoke execute on function public.claim_free_first_export(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_free_first_export(uuid, uuid) to service_role;
