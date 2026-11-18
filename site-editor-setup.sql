-- A Different Story: the admin "Edit site" page.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- Run supabase-setup.sql and roles-setup.sql first. This file is safe to run more than once.

-- 1. Site content -------------------------------------------------------------
-- One row per thing the admin has changed (headline, phone, prices, FAQs, photos...).
-- If a row is missing, the website shows its built-in text instead.
create table if not exists public.site_content (
  key text primary key check (key ~ '^[a-z0-9_]{1,60}$'),
  value jsonb not null check (octet_length(value::text) <= 60000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null
);

-- Keep "last changed" and "changed by" up to date on every save.
create or replace function public.touch_site_content()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists touch_site_content on public.site_content;
create trigger touch_site_content before insert or update on public.site_content
  for each row execute function public.touch_site_content();

-- 2. Security rules: everyone can read the site's content, only admins can change it.
alter table public.site_content enable row level security;

drop policy if exists "site content: anyone can read" on public.site_content;
create policy "site content: anyone can read" on public.site_content
  for select using (true);

drop policy if exists "site content: admins add" on public.site_content;
create policy "site content: admins add" on public.site_content
  for insert with check (public.is_admin());

drop policy if exists "site content: admins change" on public.site_content;
create policy "site content: admins change" on public.site_content
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "site content: admins remove" on public.site_content;
create policy "site content: admins remove" on public.site_content
  for delete using (public.is_admin());

grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;

-- 3. Photos -------------------------------------------------------------------
-- A public storage folder ("bucket") for section photos the admin uploads.
-- Anyone can view the photos; only admins can upload, replace or delete them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "site media: admins upload" on storage.objects;
create policy "site media: admins upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'site-media' and public.is_admin());

drop policy if exists "site media: admins replace" on storage.objects;
create policy "site media: admins replace" on storage.objects
  for update to authenticated using (bucket_id = 'site-media' and public.is_admin())
  with check (bucket_id = 'site-media' and public.is_admin());

drop policy if exists "site media: admins delete" on storage.objects;
create policy "site media: admins delete" on storage.objects
  for delete to authenticated using (bucket_id = 'site-media' and public.is_admin());

-- Quick check: this should return the new table (empty until you save something).
select key, updated_at from public.site_content order by key;
