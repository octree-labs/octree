-- What a project is, when the app knows: 'resume' for projects created by
-- the resume redesign flow (actions/create-resume-project.ts). The editor
-- shows resume-only tools (the ATS analysis) for these. NULL is an ordinary
-- LaTeX project; existing rows stay NULL.

alter table public.projects
  add column if not exists kind text;

alter table public.projects
  drop constraint if exists projects_kind_check;

alter table public.projects
  add constraint projects_kind_check check (kind in ('resume'));
