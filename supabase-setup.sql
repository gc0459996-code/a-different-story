-- A Different Story: database setup for logins, classes and enrollments.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- It is safe to run more than once.

-- 1. Tables ------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id bigint generated always as identity primary key,
  course text not null check (course in ('education', 'intervention')),
  dates text not null,               -- e.g. 'Mon–Wed, Nov 2–4'
  times text not null,               -- e.g. '6:00–10:00 pm'
  location text not null default 'Live online (Zoom)',
  sessions int not null default 3,   -- number of class meetings
  seats int not null default 16,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.enrollments (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id bigint not null references public.classes(id) on delete cascade,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid')),
  amount numeric(10,2),
  attended_sessions int not null default 0,
  test_passed boolean not null default false,
  court_order_received boolean not null default false,
  certificate_status text not null default 'not_ready' check (certificate_status in ('not_ready', 'issued')),
  created_at timestamptz not null default now()
);

-- 2. New sign-ups automatically get a profile ---------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Who is an admin ---------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 4. Security rules: students see only their own records, admins see everything

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.enrollments enable row level security;

drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: admin updates" on public.profiles;
create policy "profiles: admin updates" on public.profiles
  for update using (public.is_admin());

drop policy if exists "classes: anyone can read" on public.classes;
create policy "classes: anyone can read" on public.classes
  for select using (true);

drop policy if exists "classes: admin manages" on public.classes;
create policy "classes: admin manages" on public.classes
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "enrollments: read own or admin" on public.enrollments;
create policy "enrollments: read own or admin" on public.enrollments
  for select using (student_id = auth.uid() or public.is_admin());

-- Students can sign themselves up for a class, but only as unpaid with no progress.
drop policy if exists "enrollments: student self-enrolls" on public.enrollments;
create policy "enrollments: student self-enrolls" on public.enrollments
  for insert with check (
    student_id = auth.uid()
    and payment_status = 'unpaid'
    and attended_sessions = 0
    and test_passed = false
    and court_order_received = false
    and certificate_status = 'not_ready'
  );

drop policy if exists "enrollments: admin manages" on public.enrollments;
create policy "enrollments: admin manages" on public.enrollments
  for all using (public.is_admin()) with check (public.is_admin());

-- 5. Starter classes (edit or delete these from the admin page later) ---------

insert into public.classes (course, dates, times, sessions, seats)
select * from (values
  ('education',    'Mon–Wed, Nov 2–4',       '6:00–10:00 pm',   3, 16),
  ('education',    'Sat, Nov 14, 21, 28',    '9:00 am–1:00 pm', 3, 16),
  ('intervention', 'Tue & Thu, starts Nov 3', '6:00–9:00 pm',   11, 12),
  ('education',    'Mon–Wed, Dec 7–9',       '6:00–10:00 pm',   3, 16)
) as v(course, dates, times, sessions, seats)
where not exists (select 1 from public.classes);

-- 6. Make yourself the admin -------------------------------------------------
-- First create your account on the website (Log In > Create an account) and confirm the email.
-- Then replace the email below with yours and run just this line:
--
--   update public.profiles set is_admin = true where email = 'YOUR-EMAIL@example.com';
