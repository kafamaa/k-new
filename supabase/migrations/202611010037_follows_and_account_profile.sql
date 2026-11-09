-- Follows and account island/atoll (Additional Features list: follow on public pages,
-- Account Settings atoll/island).
-- Review-only. Do not apply, push or deploy without explicit owner authorization.
-- Apply after 202611010036_tournament_pages_complete.sql.
-- Created with `supabase migration new follows_and_account_profile`, renamed from
-- 20261101072048_… to 202611010037_… to match the other migrations.
--
--   1. follows: a signed-in person follows published tournaments, teams, players and
--      organizations. Each person sees and changes only their own follows; nobody
--      else (other users, organizers, the public) can read who follows what.
--   2. profiles.island and profiles.atoll: optional, private to the account.

-- ---------------------------------------------------------------------------------
-- 1. Follows
-- ---------------------------------------------------------------------------------
create table if not exists public.follows (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  entity_type text not null check (entity_type in ('tournament', 'team', 'player', 'organization')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, entity_type, entity_id)
);
create index if not exists follows_user_idx on public.follows(user_id, created_at desc);
alter table public.follows enable row level security;

-- Only published records can be followed.
create or replace function public.is_followable(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'tournament' then exists (select 1 from public.tournaments t where t.id = p_id and t.is_published and t.status <> 'draft')
    when 'team' then exists (select 1 from public.teams t where t.id = p_id and t.is_published)
    when 'player' then exists (select 1 from public.player_profiles p where p.id = p_id and p.is_published)
    when 'organization' then exists (select 1 from public.organizations o where o.id = p_id and o.is_published)
    else false end;
$$;

drop policy if exists "people read their own follows" on public.follows;
create policy "people read their own follows" on public.follows for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "people follow published records" on public.follows;
create policy "people follow published records" on public.follows for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_followable(entity_type, entity_id));
drop policy if exists "people unfollow" on public.follows;
create policy "people unfollow" on public.follows for delete to authenticated
  using (user_id = (select auth.uid()));
-- No update policy: a follow is added or removed, never edited.

-- Names for the caller's own follows, public fields only (a record that was unpublished
-- since shows as no longer available).
create or replace function public.my_follows()
returns table (entity_type text, entity_id uuid, label text, slug text, available boolean, followed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.entity_type, f.entity_id,
    coalesce(t.name, tm.name, p.display_name, o.name, 'No longer public'),
    coalesce(t.slug, tm.slug, p.slug, o.slug),
    coalesce(t.id, tm.id, p.id, o.id) is not null,
    f.created_at
  from public.follows f
  left join public.tournaments t on f.entity_type = 'tournament' and t.id = f.entity_id and t.is_published and t.status <> 'draft'
  left join public.teams tm on f.entity_type = 'team' and tm.id = f.entity_id and tm.is_published
  left join public.player_profiles p on f.entity_type = 'player' and p.id = f.entity_id and p.is_published
  left join public.organizations o on f.entity_type = 'organization' and o.id = f.entity_id and o.is_published
  where f.user_id = (select auth.uid())
  order by f.created_at desc;
$$;

revoke execute on function public.is_followable(text, uuid) from public, anon;
grant execute on function public.is_followable(text, uuid) to authenticated, service_role;
revoke execute on function public.my_follows() from public, anon;
grant execute on function public.my_follows() to authenticated, service_role;
revoke all on public.follows from anon;
revoke update, truncate on public.follows from authenticated;

-- ---------------------------------------------------------------------------------
-- 2. Account island and atoll (private to the account; profiles RLS is owner-only)
-- ---------------------------------------------------------------------------------
alter table public.profiles add column if not exists island text check (island is null or length(trim(island)) between 2 and 80);
alter table public.profiles add column if not exists atoll text check (atoll is null or length(trim(atoll)) between 1 and 40);
