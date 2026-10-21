-- Paywall hits (stores/paywall.ts -> lib/requests/paywall.ts).
--
-- One row each time the paywall dialog opens for a free user (daily AI-edit
-- limit, a Pro feature such as PDF export, the spent free generation). The
-- daily lifecycle cron (app/api/cron/lifecycle) reads the latest hit per
-- user to send the warm_lead_offer email (lib/lifecycle/select.ts).
--
-- A signed-in user may insert their own rows and nothing else: no select,
-- update or delete, and only the user_id / feature / reason columns (id and
-- created_at always come from the defaults, so a client cannot backdate a
-- hit into the email window). feature and reason are bounded to 64
-- characters. The cron reads through the service role. Re-running this
-- file is safe. It does not touch user_usage or its guard triggers.

create table if not exists public.paywall_hits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- Added separately so a table created by an earlier run of this file gets
-- them too.
alter table public.paywall_hits drop constraint if exists paywall_hits_text_length;
alter table public.paywall_hits
  add constraint paywall_hits_text_length
  check (char_length(feature) <= 64 and char_length(reason) <= 64);

create index if not exists paywall_hits_user_id_created_at_idx
  on public.paywall_hits (user_id, created_at desc);

-- The cron's read: the last week of hits across all users.
create index if not exists paywall_hits_created_at_idx
  on public.paywall_hits (created_at);

alter table public.paywall_hits enable row level security;

revoke all on table public.paywall_hits from anon, authenticated;
grant insert (user_id, feature, reason) on table public.paywall_hits to authenticated;
grant all on table public.paywall_hits to service_role;

drop policy if exists "Users can record their own paywall hits" on public.paywall_hits;
create policy "Users can record their own paywall hits"
  on public.paywall_hits for insert to authenticated
  with check (auth.uid() = user_id);
