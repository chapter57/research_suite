-- Research Suite: let people choose a teacher account when they sign up.
-- Run once in Supabase (SQL Editor -> New query -> paste -> Run). Safe to run again.
-- A teacher can only create classes; they see student work only when students
-- join their class with its code and choose to turn work in.
grant insert on public.instructors to authenticated;
drop policy if exists "become an instructor" on public.instructors;
create policy "become an instructor" on public.instructors
  for insert to authenticated with check (user_id = (select auth.uid()));
