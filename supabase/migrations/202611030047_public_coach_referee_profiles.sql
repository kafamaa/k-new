-- Review-only: the owner applies it. Additive.
--
-- Public coach and referee directories (unified plan sections 7.2 and 32.2)
-- with consent: nobody appears until they switch on their own public profile.
-- The person chooses the public name, island and short biography; the
-- database checks they actually hold the role (a coach role in a team, or at
-- least one official assignment). Visitors read only switched-on profiles and
-- facts derived from published records - never email, phone or account data.

create table if not exists public.public_person_profiles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('coach', 'referee')),
  public_id uuid not null default gen_random_uuid() unique,
  display_name text not null check (length(trim(display_name)) between 2 and 80),
  island text check (island is null or length(trim(island)) between 1 and 60),
  bio text check (bio is null or length(bio) <= 600),
  is_public boolean not null default false,
  consent_version text not null default 'public-person-profile-1',
  consented_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.public_person_profiles enable row level security;
-- Only the person reads their own row directly; visitors use the functions below.
drop policy if exists "people read own public profile" on public.public_person_profiles;
create policy "people read own public profile" on public.public_person_profiles for select to authenticated using (user_id = (select auth.uid()));
grant select on public.public_person_profiles to authenticated;

create or replace function public.person_holds_role(p_user uuid, p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_role
    when 'coach' then exists (select 1 from public.team_memberships m where m.user_id = p_user and m.role = 'coach')
    when 'referee' then exists (select 1 from public.match_official_assignments a where a.user_id = p_user and a.role = 'official')
    else false end;
$$;
revoke execute on function public.person_holds_role(uuid, text) from public, anon, authenticated;

-- The signed-in person's own roles and profiles, for Account Settings.
create or replace function public.get_my_public_person_profiles()
returns table(role text, eligible boolean, public_id uuid, display_name text, island text, bio text, is_public boolean)
language sql stable security definer set search_path = '' as $$
  select r.role, public.person_holds_role(auth.uid(), r.role), p.public_id, p.display_name, p.island, p.bio, coalesce(p.is_public, false)
  from (values ('coach'), ('referee')) as r(role)
  left join public.public_person_profiles p on p.user_id = auth.uid() and p.role = r.role
  where auth.uid() is not null;
$$;
revoke execute on function public.get_my_public_person_profiles() from public, anon;
grant execute on function public.get_my_public_person_profiles() to authenticated, service_role;

create or replace function public.save_public_person_profile(p_role text, p_is_public boolean, p_display_name text, p_island text, p_bio text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if p_role not in ('coach', 'referee') then raise exception 'invalid_role'; end if;
  if p_is_public and not public.person_holds_role(auth.uid(), p_role) then raise exception 'role_not_held'; end if;
  if p_display_name is null or length(trim(p_display_name)) < 2 then raise exception 'name_required'; end if;
  insert into public.public_person_profiles (user_id, role, display_name, island, bio, is_public, consented_at, updated_at)
  values (auth.uid(), p_role, left(trim(p_display_name), 80), nullif(left(trim(coalesce(p_island, '')), 60), ''), nullif(left(trim(coalesce(p_bio, '')), 600), ''), p_is_public, case when p_is_public then now() end, now())
  on conflict (user_id, role) do update set display_name = excluded.display_name, island = excluded.island, bio = excluded.bio, is_public = excluded.is_public,
    consented_at = case when excluded.is_public then coalesce(public.public_person_profiles.consented_at, now()) else null end, updated_at = now()
  returning public_id into v_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), case when p_is_public then 'public_profile_shown' else 'public_profile_hidden' end, 'public_person_profile', v_id, p_role);
  return v_id;
end;
$$;
revoke execute on function public.save_public_person_profile(text, boolean, text, text, text) from public, anon;
grant execute on function public.save_public_person_profile(text, boolean, text, text, text) to authenticated, service_role;

-- Directory: switched-on profiles only, with counts from published records.
create or replace function public.get_public_people(p_role text, p_search text default null, p_limit integer default 60, p_offset integer default 0)
returns table(public_id uuid, display_name text, island text, bio text, matches_officiated bigint, teams_coached bigint)
language sql stable security definer set search_path = '' as $$
  select p.public_id, p.display_name, p.island, p.bio,
    case when p.role = 'referee' then (select count(distinct a.match_id) from public.match_official_assignments a join public.matches m on m.id = a.match_id join public.tournaments t on t.id = m.tournament_id
      where a.user_id = p.user_id and a.role = 'official' and m.status = 'confirmed' and t.is_published) else 0 end,
    case when p.role = 'coach' then (select count(distinct tm.team_id) from public.team_memberships tm join public.teams te on te.id = tm.team_id
      where tm.user_id = p.user_id and tm.role = 'coach' and te.is_published) else 0 end
  from public.public_person_profiles p
  where p.role = p_role and p.is_public and public.person_holds_role(p.user_id, p.role)
    and (p_search is null or p_search = '' or p.display_name ilike '%' || replace(replace(p_search, '%', ''), '_', '') || '%' or p.island ilike '%' || replace(replace(p_search, '%', ''), '_', '') || '%')
  order by p.display_name
  limit least(greatest(coalesce(p_limit, 60), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.get_public_people(text, text, integer, integer) from public;
grant execute on function public.get_public_people(text, text, integer, integer) to anon, authenticated, service_role;

-- One person: profile plus published teams coached or recent official matches.
create or replace function public.get_public_person(p_public_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'public_id', p.public_id, 'role', p.role, 'display_name', p.display_name, 'island', p.island, 'bio', p.bio,
    'teams', case when p.role = 'coach' then coalesce((select jsonb_agg(jsonb_build_object('name', te.name, 'slug', te.slug) order by te.name)
      from public.team_memberships tm join public.teams te on te.id = tm.team_id where tm.user_id = p.user_id and tm.role = 'coach' and te.is_published), '[]'::jsonb) else '[]'::jsonb end,
    'matches', case when p.role = 'referee' then coalesce((select jsonb_agg(x order by x->>'scheduled_at' desc) from (
      select jsonb_build_object('id', m.id, 'scheduled_at', m.scheduled_at, 'tournament', t.name, 'tournament_slug', t.slug, 'home', ht.name, 'away', at.name) as x
      from public.match_official_assignments a join public.matches m on m.id = a.match_id join public.tournaments t on t.id = m.tournament_id
      left join public.teams ht on ht.id = m.home_team_id left join public.teams at on at.id = m.away_team_id
      where a.user_id = p.user_id and a.role = 'official' and m.status = 'confirmed' and t.is_published
      order by m.scheduled_at desc nulls last limit 20) s), '[]'::jsonb) else '[]'::jsonb end)
  from public.public_person_profiles p
  where p.public_id = p_public_id and p.is_public and public.person_holds_role(p.user_id, p.role);
$$;
revoke execute on function public.get_public_person(uuid) from public;
grant execute on function public.get_public_person(uuid) to anon, authenticated, service_role;
