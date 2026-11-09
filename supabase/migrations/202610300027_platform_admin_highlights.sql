-- Platform administration and homepage highlights.
-- Review-only; do not apply or push without explicit owner authorization.
--
-- Super Admin is an internal platform role (Product Specification 3.5): it is
-- never available through signup or any client write. The owner grants it by
-- running, in the Supabase SQL editor:
--   insert into public.platform_admins (user_id, note) values ('<auth user id>', 'Owner');
-- Platform admins manage the homepage highlight panel: platform notices,
-- sponsors, promoted tournaments and announcements.

create table if not exists public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
-- A signed-in person may only see whether they themselves are an admin.
-- There is deliberately no insert/update/delete policy: grants happen only
-- through the SQL editor (service role).
drop policy if exists "admins read own admin row" on public.platform_admins;
create policy "admins read own admin row" on public.platform_admins for select to authenticated using (user_id = auth.uid());

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid());
$$;
revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

create table if not exists public.platform_highlights (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('notice', 'sponsor', 'tournament', 'promotion')),
  title text not null check (length(trim(title)) between 1 and 120),
  body text check (body is null or length(body) <= 400),
  image_url text check (image_url is null or image_url ~ '^https://'),
  link_url text check (link_url is null or link_url ~ '^(https://|#)'),
  link_label text check (link_label is null or length(link_label) <= 40),
  tournament_id uuid references public.tournaments(id) on delete set null,
  starts_at timestamptz,
  ends_at timestamptz,
  priority integer not null default 0,
  is_active boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists platform_highlights_live_idx on public.platform_highlights(is_active, priority desc);
alter table public.platform_highlights enable row level security;

-- Everyone (guests included) sees only active highlights inside their window.
drop policy if exists "live highlights are public" on public.platform_highlights;
create policy "live highlights are public" on public.platform_highlights for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
-- Platform admins see and manage every highlight, including drafts.
drop policy if exists "platform admins manage highlights" on public.platform_highlights;
create policy "platform admins manage highlights" on public.platform_highlights for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin() and created_by is not null);

-- Highlight images in the public-media bucket (migration 024), under
-- platform/highlights/. Only platform admins may write there.
drop policy if exists "platform admins upload highlight images" on storage.objects;
create policy "platform admins upload highlight images" on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'platform' and public.is_platform_admin());
drop policy if exists "platform admins remove highlight images" on storage.objects;
create policy "platform admins remove highlight images" on storage.objects for delete to authenticated
  using (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'platform' and public.is_platform_admin());
