-- Research Suite cloud storage. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run again: it only creates what is missing.
-- Every table is locked so that each signed-in person can reach only their own projects.

-- Projects: one row per paper.
create table if not exists public.projects (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Untitled project',
  doc jsonb,
  word_count integer not null default 0,
  event_count integer not null default 0,
  author text,
  mla jsonb,
  snapshot_seq integer,
  snapshot_doc jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner_idx on public.projects (owner);

-- The writing-process recording, uploaded in chunks of consecutive events.
-- A later chunk may overlap the end of an earlier one; the later one wins.
create table if not exists public.event_chunks (
  project_id uuid not null references public.projects (id) on delete cascade,
  start_seq integer not null,
  events jsonb not null,
  created_at timestamptz not null default now(),
  primary key (project_id, start_seq)
);

-- Reflections pinned to moments in the replay. Voice notes live in Storage.
create table if not exists public.reflections (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  at integer not null,
  kind text not null check (kind in ('text', 'audio')),
  text text,
  audio_path text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists reflections_project_idx on public.reflections (project_id);

-- ---------- Security: owners only ----------
-- Signed-in users may use these tables (the policies below limit them to their own rows).
-- Signed-out visitors get nothing.
grant select, insert, update, delete on public.projects, public.event_chunks, public.reflections to authenticated;
revoke all on public.projects, public.event_chunks, public.reflections from anon;

alter table public.projects enable row level security;
alter table public.event_chunks enable row level security;
alter table public.reflections enable row level security;

drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

drop policy if exists "own recordings" on public.event_chunks;
create policy "own recordings" on public.event_chunks
  for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner = (select auth.uid())));

drop policy if exists "own reflections" on public.reflections;
create policy "own reflections" on public.reflections
  for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner = (select auth.uid())));

-- ---------- Voice notes: a private storage bucket, one folder per person ----------
insert into storage.buckets (id, name, public)
values ('voice-notes', 'voice-notes', false)
on conflict (id) do nothing;

drop policy if exists "own voice notes" on storage.objects;
create policy "own voice notes" on storage.objects
  for all to authenticated
  using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = (select auth.uid())::text);
