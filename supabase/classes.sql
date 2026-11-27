-- Research Suite: classes, joining by code, and turning work in.
-- Run once in Supabase (SQL Editor -> New query -> paste -> Run). Safe to run again.
--
-- Who sees what:
--   * Instructors (listed in public.instructors) create classes and get a join code.
--   * Students join with the code.
--   * A student's project is visible to a class's instructor only after the student
--     turns it in to that class, and then read-only. Drafts stay private.

create table if not exists public.instructors (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.enrollments (
  class_id uuid not null references public.classes (id) on delete cascade,
  student uuid not null references auth.users (id) on delete cascade,
  student_name text not null default '',
  student_email text not null default '',
  joined_at timestamptz not null default now(),
  primary key (class_id, student)
);

create table if not exists public.submissions (
  class_id uuid not null references public.classes (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  student uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  event_count integer not null,
  word_count integer not null default 0,
  turned_in_at timestamptz not null default now(),
  primary key (class_id, project_id)
);
create index if not exists submissions_project_idx on public.submissions (project_id);

-- ---------- Helper checks (run with owner rights so policies don't loop) ----------
create or replace function public.is_instructor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.instructors where user_id = auth.uid());
$$;

create or replace function public.teaches(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.classes where id = cid and teacher = auth.uid());
$$;

create or replace function public.enrolled_in(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments where class_id = cid and student = auth.uid());
$$;

create or replace function public.owns_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects where id = pid and owner = auth.uid());
$$;

-- An instructor may read a project once it has been turned in to one of their classes.
create or replace function public.can_review(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.submissions s join public.classes c on c.id = s.class_id
    where s.project_id = pid and c.teacher = auth.uid()
  );
$$;

create or replace function public.can_review_folder(folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.submissions s join public.classes c on c.id = s.class_id
    where s.project_id::text = folder and c.teacher = auth.uid()
  );
$$;

-- Students join with a code (they can't see the class list, so this runs with owner rights).
create or replace function public.join_class(join_code text)
returns table (class_id uuid, class_name text)
language plpgsql security definer set search_path = public as $$
declare
  found_id uuid;
  found_name text;
  uname text;
  uemail text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;
  select c.id, c.name into found_id, found_name
  from public.classes c where upper(c.code) = upper(trim(join_code));
  if found_id is null then
    raise exception 'No class has that code. Check it with your instructor.';
  end if;
  select coalesce(u.raw_user_meta_data ->> 'display_name', u.email), u.email into uname, uemail
  from auth.users u where u.id = auth.uid();
  insert into public.enrollments (class_id, student, student_name, student_email)
  values (found_id, auth.uid(), coalesce(uname, ''), coalesce(uemail, ''))
  on conflict on constraint enrollments_pkey
  do update set student_name = excluded.student_name, student_email = excluded.student_email;
  return query select found_id, found_name;
end;
$$;
revoke all on function public.join_class(text) from public, anon;
grant execute on function public.join_class(text) to authenticated;

-- ---------- Access ----------
alter table public.instructors enable row level security;
alter table public.classes enable row level security;
alter table public.enrollments enable row level security;
alter table public.submissions enable row level security;

grant select on public.instructors to authenticated;
grant select, insert, update, delete on public.classes, public.enrollments, public.submissions to authenticated;
revoke all on public.instructors, public.classes, public.enrollments, public.submissions from anon;

drop policy if exists "see own instructor status" on public.instructors;
create policy "see own instructor status" on public.instructors
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "see classes" on public.classes;
create policy "see classes" on public.classes
  for select to authenticated using (teacher = (select auth.uid()) or public.enrolled_in(id));
drop policy if exists "instructors create classes" on public.classes;
create policy "instructors create classes" on public.classes
  for insert to authenticated with check (teacher = (select auth.uid()) and public.is_instructor());
drop policy if exists "teachers edit classes" on public.classes;
create policy "teachers edit classes" on public.classes
  for update to authenticated using (teacher = (select auth.uid())) with check (teacher = (select auth.uid()));
drop policy if exists "teachers delete classes" on public.classes;
create policy "teachers delete classes" on public.classes
  for delete to authenticated using (teacher = (select auth.uid()));

drop policy if exists "see enrollments" on public.enrollments;
create policy "see enrollments" on public.enrollments
  for select to authenticated using (student = (select auth.uid()) or public.teaches(class_id));
drop policy if exists "leave or remove" on public.enrollments;
create policy "leave or remove" on public.enrollments
  for delete to authenticated using (student = (select auth.uid()) or public.teaches(class_id));

drop policy if exists "see submissions" on public.submissions;
create policy "see submissions" on public.submissions
  for select to authenticated using (student = (select auth.uid()) or public.teaches(class_id));
drop policy if exists "turn in" on public.submissions;
create policy "turn in" on public.submissions
  for insert to authenticated
  with check (student = (select auth.uid()) and public.enrolled_in(class_id) and public.owns_project(project_id));
drop policy if exists "turn in again" on public.submissions;
create policy "turn in again" on public.submissions
  for update to authenticated
  using (student = (select auth.uid()))
  with check (student = (select auth.uid()) and public.enrolled_in(class_id) and public.owns_project(project_id));
drop policy if exists "withdraw or clear" on public.submissions;
create policy "withdraw or clear" on public.submissions
  for delete to authenticated using (student = (select auth.uid()) or public.teaches(class_id));

-- Instructors may READ turned-in work (never change it).
drop policy if exists "teachers review projects" on public.projects;
create policy "teachers review projects" on public.projects
  for select to authenticated using (public.can_review(id));
drop policy if exists "teachers review recordings" on public.event_chunks;
create policy "teachers review recordings" on public.event_chunks
  for select to authenticated using (public.can_review(project_id));
drop policy if exists "teachers review reflections" on public.reflections;
create policy "teachers review reflections" on public.reflections
  for select to authenticated using (public.can_review(project_id));
drop policy if exists "teachers hear voice notes" on storage.objects;
create policy "teachers hear voice notes" on storage.objects
  for select to authenticated
  using (bucket_id = 'voice-notes' and public.can_review_folder((storage.foldername(name))[2]));
