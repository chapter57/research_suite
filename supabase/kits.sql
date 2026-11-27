-- Research Suite: course kits ("cartridges").
-- Run once in Supabase (SQL Editor -> New query -> paste -> Run). Safe to run again.
--
-- A kit describes a course: catalog title, ethos, objectives, citation style and
-- guidance for the AI coach. Teachers keep kits on their shelf and edit them freely.
-- Creating a class plugs in a frozen copy of a kit. The copy can be swapped only
-- until the first student joins; after that it is locked for good.

create table if not exists public.kits (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kits_owner_idx on public.kits (owner);

alter table public.kits enable row level security;
grant select, insert, update, delete on public.kits to authenticated;
revoke all on public.kits from anon;

drop policy if exists "own kits" on public.kits;
create policy "own kits" on public.kits
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()) and public.is_instructor());

-- The kit plugged into a class (a frozen copy).
alter table public.classes add column if not exists kit jsonb;

create or replace function public.lock_class_kit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kit is distinct from old.kit
     and exists (select 1 from public.enrollments where class_id = old.id) then
    raise exception 'This class''s course kit is locked because students have joined.';
  end if;
  return new;
end;
$$;
drop trigger if exists lock_class_kit on public.classes;
create trigger lock_class_kit before update on public.classes
  for each row execute function public.lock_class_kit();

-- Which class (or, for a teacher trying things out, which kit) a project is written for.
alter table public.projects add column if not exists class_id uuid references public.classes (id) on delete set null;
alter table public.projects add column if not exists kit_id uuid references public.kits (id) on delete set null;
