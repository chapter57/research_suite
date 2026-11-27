-- Research Suite: Moodle connection (LTI 1.3).
-- Run once in Supabase (SQL Editor -> New query -> paste -> Run). Safe to run again.
--
-- lti_registrations: a teacher connects one of their classes to a Moodle course.
-- lti_users: which Research Suite account belongs to which Moodle user. Only the
-- server (with the secret key) reads or writes it; no one can do so from a browser.

create table if not exists public.lti_registrations (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  teacher uuid not null default auth.uid() references auth.users (id) on delete cascade,
  issuer text not null,
  client_id text not null,
  deployment_id text not null,
  auth_url text not null,
  jwks_url text not null,
  token_url text not null,
  created_at timestamptz not null default now(),
  unique (issuer, client_id, deployment_id)
);

alter table public.lti_registrations enable row level security;
grant select, insert, delete on public.lti_registrations to authenticated;
revoke all on public.lti_registrations from anon;

drop policy if exists "teachers see their connections" on public.lti_registrations;
create policy "teachers see their connections" on public.lti_registrations
  for select to authenticated using (teacher = (select auth.uid()));
drop policy if exists "teachers connect their classes" on public.lti_registrations;
create policy "teachers connect their classes" on public.lti_registrations
  for insert to authenticated with check (teacher = (select auth.uid()) and public.teaches(class_id));
drop policy if exists "teachers disconnect" on public.lti_registrations;
create policy "teachers disconnect" on public.lti_registrations
  for delete to authenticated using (teacher = (select auth.uid()));

create table if not exists public.lti_users (
  issuer text not null,
  sub text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issuer, sub)
);
alter table public.lti_users enable row level security;
revoke all on public.lti_users from anon, authenticated;
