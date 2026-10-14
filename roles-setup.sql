-- A Different Story: roles and permissions for staff accounts.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- It is safe to run more than once.

-- Roles: student, instructor, staff, admin.
-- Permissions: classes, students, payments, accounts. Admins always have all of them.
alter table public.profiles add column if not exists role text not null default 'student';
alter table public.profiles add column if not exists permissions text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('student','instructor','staff','admin'));
alter table public.profiles drop constraint if exists profiles_permissions_check;
alter table public.profiles add constraint profiles_permissions_check check (permissions <@ array['classes','students','payments','accounts']::text[]);

-- Anyone who is already an admin keeps full access.
update public.profiles set role = 'admin', permissions = array['classes','students','payments','accounts'] where is_admin;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'student');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin';
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() <> 'student';
$$;

create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' or (role <> 'student' and p = any(permissions)) from public.profiles where id = auth.uid()), false);
$$;

-- Profiles: you see your own, staff see everyone. Changes go through the admin-users function.
drop policy if exists "profiles: read own or admin" on public.profiles;
drop policy if exists "profiles: read own or staff" on public.profiles;
create policy "profiles: read own or staff" on public.profiles
  for select using (id = auth.uid() or public.is_staff());

-- Classes: anyone can read, staff with the classes permission manage them.
drop policy if exists "classes: admin manages" on public.classes;
drop policy if exists "classes: staff with permission manage" on public.classes;
create policy "classes: staff with permission manage" on public.classes
  for all using (public.has_perm('classes')) with check (public.has_perm('classes'));

-- Enrollments: students see their own, staff see all, staff with permission make changes.
drop policy if exists "enrollments: admin manages" on public.enrollments;
drop policy if exists "enrollments: read own or admin" on public.enrollments;
drop policy if exists "enrollments: read own or staff" on public.enrollments;
drop policy if exists "enrollments: staff add" on public.enrollments;
drop policy if exists "enrollments: staff update" on public.enrollments;
drop policy if exists "enrollments: staff delete" on public.enrollments;
create policy "enrollments: read own or staff" on public.enrollments
  for select using (student_id = auth.uid() or public.is_staff());
create policy "enrollments: staff add" on public.enrollments
  for insert with check (public.has_perm('students'));
create policy "enrollments: staff update" on public.enrollments
  for update using (public.has_perm('students') or public.has_perm('payments'))
  with check (public.has_perm('students') or public.has_perm('payments'));
create policy "enrollments: staff delete" on public.enrollments
  for delete using (public.has_perm('students'));

-- Payment fields need the payments permission; progress fields need the students permission.
create or replace function public.guard_enrollment_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.payment_status is distinct from old.payment_status or new.amount is distinct from old.amount)
     and not public.has_perm('payments') then
    raise exception 'You do not have permission to change payments.';
  end if;
  if (new.attended_sessions is distinct from old.attended_sessions or new.test_passed is distinct from old.test_passed
      or new.court_order_received is distinct from old.court_order_received or new.certificate_status is distinct from old.certificate_status
      or new.class_id is distinct from old.class_id or new.student_id is distinct from old.student_id)
     and not public.has_perm('students') then
    raise exception 'You do not have permission to change student progress.';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_enrollment_update on public.enrollments;
create trigger guard_enrollment_update before update on public.enrollments
  for each row execute function public.guard_enrollment_update();

-- Quick check: this should list your account as admin.
select email, role, permissions from public.profiles where role <> 'student';
