-- Idempotency log for Stripe webhook deliveries. Stripe retries events that do
-- not get a 2xx; the webhook inserts each event id here first and skips any
-- event whose id already exists. Only the service role touches this table.

create table if not exists public.stripe_webhook_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

revoke all on table public.stripe_webhook_events from anon, authenticated;
grant all on table public.stripe_webhook_events to service_role;
