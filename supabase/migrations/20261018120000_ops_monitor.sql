-- State for the uptime monitor (app/api/cron/health-check). One row per
-- check; `status` is up | failing | down, `since` is when that status began
-- (for an outage, the first failed probe). Only the service role touches it.

create table if not exists public.ops_monitor_state (
  check_name text primary key,
  status text not null default 'up' check (status in ('up', 'failing', 'down')),
  since timestamptz not null default now(),
  last_checked timestamptz not null default now(),
  last_error text,
  last_alert_at timestamptz
);

alter table public.ops_monitor_state enable row level security;

revoke all on table public.ops_monitor_state from anon, authenticated;
grant all on table public.ops_monitor_state to service_role;
