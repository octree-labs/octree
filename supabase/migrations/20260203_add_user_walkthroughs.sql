create table if not exists public.user_walkthroughs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dashboard_seen boolean not null default false,
  dashboard_seen_at timestamptz,
  generated_first_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.user_walkthroughs enable row level security;

create policy "Users can view their walkthrough status"
  on public.user_walkthroughs
  for select
  using (auth.uid() = user_id);

create policy "Users can insert their walkthrough status"
  on public.user_walkthroughs
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their walkthrough status"
  on public.user_walkthroughs
  for update
  using (auth.uid() = user_id);
