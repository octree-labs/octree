-- Lifecycle and win-back emails (app/api/cron/lifecycle).
--
-- lifecycle_emails: one row per (user, template) ever attempted. The unique
-- key is the dedupe: the cron inserts before it sends, and a second run can
-- never send the same template to the same person twice. A send Resend
-- rejected keeps its row with `error` set and no `resend_id`; later runs
-- retry it through claim_lifecycle_retry until `attempts` reaches the cap
-- (MAX_SEND_ATTEMPTS in lib/lifecycle/load.ts). Service role only; nothing
-- in the browser reads it.
--
-- email_preferences: the marketing opt-out a user sets through the
-- unsubscribe link in every lifecycle email. A user may read and update their
-- own row; the cron (service role) reads all of them before sending.

create table if not exists public.lifecycle_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  template text not null,
  sent_at timestamptz not null default now(),
  resend_id text,
  error text,
  attempts integer not null default 1,
  unique (user_id, template)
);

alter table public.lifecycle_emails add column if not exists error text;
alter table public.lifecycle_emails add column if not exists attempts integer not null default 1;

alter table public.lifecycle_emails enable row level security;

revoke all on table public.lifecycle_emails from anon, authenticated;
grant all on table public.lifecycle_emails to service_role;

-- Takes over a failed row for another attempt. One UPDATE, so two
-- overlapping cron runs cannot both claim it. Returns true when the row was
-- taken, false when there was nothing retryable (sent, in flight, or out of
-- attempts).
create or replace function public.claim_lifecycle_retry(
  p_user_id uuid,
  p_template text,
  p_email text,
  p_max_attempts integer
) returns boolean
language sql
security definer
set search_path = public
as $$
  with taken as (
    update public.lifecycle_emails
       set error = null,
           attempts = attempts + 1,
           sent_at = now(),
           email = p_email
     where user_id = p_user_id
       and template = p_template
       and resend_id is null
       and error is not null
       and attempts < p_max_attempts
    returning id
  )
  select exists (select 1 from taken);
$$;

revoke execute on function public.claim_lifecycle_retry(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_lifecycle_retry(uuid, text, text, integer) to service_role;

create table if not exists public.email_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  marketing_opt_out boolean not null default false,
  updated_at timestamptz default now()
);

alter table public.email_preferences enable row level security;

revoke all on table public.email_preferences from anon;
grant select, insert, update on table public.email_preferences to authenticated;
grant all on table public.email_preferences to service_role;

drop policy if exists "Users can read their own email preferences" on public.email_preferences;
create policy "Users can read their own email preferences"
  on public.email_preferences for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own email preferences" on public.email_preferences;
create policy "Users can create their own email preferences"
  on public.email_preferences for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own email preferences" on public.email_preferences;
create policy "Users can update their own email preferences"
  on public.email_preferences for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
