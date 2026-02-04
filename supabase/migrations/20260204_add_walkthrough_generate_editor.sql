-- Add generate and editor walkthrough tracking to user_walkthroughs.
-- Dashboard is already tracked via dashboard_seen / dashboard_seen_at.

alter table public.user_walkthroughs
  add column if not exists generate_seen boolean not null default false,
  add column if not exists generate_seen_at timestamptz,
  add column if not exists editor_seen boolean not null default false,
  add column if not exists editor_seen_at timestamptz;
