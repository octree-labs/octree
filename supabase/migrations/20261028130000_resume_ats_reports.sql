-- The latest ATS analysis of a resume project (app/api/resume/ats), so the
-- editor's ATS tab shows it again on reopen without another model call.
--
-- One row per project, overwritten on every run. tex_hash is the SHA-256
-- (hex) of the LaTeX that was analyzed; the editor compares it with the
-- current source to mark the report as outdated. Owners read and write their
-- own rows through the API route (user's session); RLS checks that the
-- project is theirs.

create table if not exists public.resume_ats_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  report jsonb not null,
  job_description text,
  tex_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create index if not exists resume_ats_reports_user_id_idx
  on public.resume_ats_reports (user_id);

alter table public.resume_ats_reports enable row level security;

revoke all on table public.resume_ats_reports from public, anon, authenticated;
grant select, insert, update on table public.resume_ats_reports to authenticated;
grant all on table public.resume_ats_reports to service_role;

drop policy if exists "Owners can read their ATS reports" on public.resume_ats_reports;
create policy "Owners can read their ATS reports"
  on public.resume_ats_reports for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Owners can save ATS reports for their projects" on public.resume_ats_reports;
create policy "Owners can save ATS reports for their projects"
  on public.resume_ats_reports for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

drop policy if exists "Owners can update their ATS reports" on public.resume_ats_reports;
create policy "Owners can update their ATS reports"
  on public.resume_ats_reports for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );
