-- ===========================================================================
-- 032 — Public Landing Page: public feeds, announcements, reports, info pages
-- ===========================================================================
-- Review-only. The owner applies it after 024 and 026–031.
--
-- Why this exists: guests can read only CONFIRMED matches (policy "published
-- matches are public"), and official scores live in match_result_versions,
-- which has no guest read policy. So the landing page could not show live
-- matches, today's schedule, or any score. Rather than widening table
-- policies, a narrow SECURITY DEFINER function returns exactly the public
-- columns, for published tournaments and published draws only.
--
-- Public boundaries kept here:
--   * Only tournaments that are published and not draft.
--   * Only matches in stages whose draw is published (competition_stages.published_at).
--   * Scores only for confirmed matches, from the LATEST confirmed version, so a
--     corrected result replaces the earlier one and never appears twice.
--     Submitted, rejected or conflicting versions are never read.
--   * Team names only for published teams, or teams with an approved entry in
--     that published tournament (their participation is already public there).
--   * No ids of accounts, no notes, no documents, no payment or finance data.
-- ===========================================================================

-- 1. Public match feed -------------------------------------------------------
create or replace function public.get_public_match_feed(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_statuses text[] default null,
  p_tournament_id uuid default null,
  p_limit integer default 60,
  p_newest_first boolean default false
)
returns table(
  match_id uuid, tournament_id uuid, tournament_name text, tournament_slug text, sport text,
  stage_id uuid, stage_name text, stage_format text, stage_order smallint, group_name text, leg smallint,
  scheduled_at timestamptz, venue text, status text,
  home_team_id uuid, home_name text, home_slug text, home_logo text,
  away_team_id uuid, away_name text, away_slug text, away_logo text,
  home_score numeric, away_score numeric, result_outcome text, confirmed_at timestamptz, corrected boolean
)
language sql stable security definer set search_path = public as $$
  with visible as (
    select m.* from public.matches m
    join public.tournaments tr on tr.id = m.tournament_id and tr.is_published and tr.status <> 'draft'
    join public.competition_stages st on st.id = m.stage_id and st.published_at is not null
    where (p_from is null or m.scheduled_at >= p_from)
      and (p_to is null or m.scheduled_at < p_to)
      and (p_statuses is null or m.status = any(p_statuses))
      and (p_tournament_id is null or m.tournament_id = p_tournament_id)
    order by
      case when p_newest_first then m.scheduled_at end desc nulls last,
      case when not p_newest_first then m.scheduled_at end asc nulls last
    limit least(greatest(coalesce(p_limit, 60), 1), 200)
  ), latest as (
    select distinct on (v.match_id) v.match_id, v.score, v.created_at, v.version
    from public.match_result_versions v join visible on visible.id = v.match_id
    where v.status = 'confirmed'
    order by v.match_id, v.version desc
  )
  select m.id, m.tournament_id, tr.name, tr.slug, tr.sport,
    st.id, st.name, st.format, st.stage_order, g.name, m.leg,
    m.scheduled_at, m.venue, m.status,
    m.home_team_id, case when hm.shown then hm.name end, case when hm.is_published then hm.slug end, case when hm.shown then hm.logo_url end,
    m.away_team_id, case when aw.shown then aw.name end, case when aw.is_published then aw.slug end, case when aw.shown then aw.logo_url end,
    case when m.status = 'confirmed' and jsonb_typeof(l.score->'home') = 'number' then (l.score->>'home')::numeric end,
    case when m.status = 'confirmed' and jsonb_typeof(l.score->'away') = 'number' then (l.score->>'away')::numeric end,
    case when m.status = 'confirmed' and l.score->>'outcome' in ('walkover', 'forfeit', 'abandoned') then l.score->>'outcome' end,
    case when m.status = 'confirmed' then l.created_at end,
    coalesce(m.status = 'confirmed' and l.version > 1 and exists (
      select 1 from public.match_result_versions older where older.match_id = m.id and older.status = 'confirmed' and older.version < l.version
    ), false)
  from visible m
  join public.tournaments tr on tr.id = m.tournament_id
  join public.competition_stages st on st.id = m.stage_id
  left join public.competition_groups g on g.id = m.group_id
  left join lateral (
    select t.name, t.slug, t.logo_url, t.is_published,
      (t.is_published or exists (select 1 from public.tournament_entries e where e.team_id = t.id and e.tournament_id = m.tournament_id and e.application_status = 'approved')) as shown
    from public.teams t where t.id = m.home_team_id
  ) hm on true
  left join lateral (
    select t.name, t.slug, t.logo_url, t.is_published,
      (t.is_published or exists (select 1 from public.tournament_entries e where e.team_id = t.id and e.tournament_id = m.tournament_id and e.application_status = 'approved')) as shown
    from public.teams t where t.id = m.away_team_id
  ) aw on true
  left join latest l on l.match_id = m.id
  order by
    case when p_newest_first then m.scheduled_at end desc nulls last,
    case when not p_newest_first then m.scheduled_at end asc nulls last;
$$;
revoke execute on function public.get_public_match_feed(timestamptz, timestamptz, text[], uuid, integer, boolean) from public;
grant execute on function public.get_public_match_feed(timestamptz, timestamptz, text[], uuid, integer, boolean) to anon, authenticated, service_role;

-- 2. Top players from confirmed official statistics --------------------------
-- Same counting as get_player_official_statistics (confirmed results only),
-- for published players only. The browser applies the documented rating
-- formula (src/lib/playerRating.ts); players under the minimum number of
-- appearances are not returned, so they can never be ranked.
create or replace function public.get_public_top_players(p_sport text default null, p_min_appearances integer default 3, p_limit integer default 60)
returns table(player_id uuid, display_name text, slug text, photo_url text, sport text, team_name text, team_slug text,
  appearances bigint, goals bigint, assists bigint, yellow_cards bigint, red_cards bigint)
language sql stable security definer set search_path = public as $$
  with confirmed as (
    select m.id, m.tournament_id from public.matches m
    join public.tournaments tr on tr.id = m.tournament_id and tr.is_published and tr.status <> 'draft'
    where m.status = 'confirmed'
      and exists (select 1 from public.match_result_versions v where v.match_id = m.id and v.status = 'confirmed')
      and (p_sport is null or tr.sport = p_sport)
  ), events as (
    select ev.match_id, ev.player_id,
      count(*) filter (where ev.event_type in ('goal','point','one_point','two_point','three_point')) as goals,
      count(*) filter (where ev.event_type = 'assist') as assists,
      count(*) filter (where ev.event_type = 'yellow_card') as yellow,
      count(*) filter (where ev.event_type in ('red_card','blue_card')) as red
    from public.match_events ev join confirmed c on c.id = ev.match_id
    group by ev.match_id, ev.player_id
  ), totals as (
    select mp.player_id,
      count(distinct mp.match_id) as appearances,
      coalesce(sum(e.goals), 0)::bigint as goals, coalesce(sum(e.assists), 0)::bigint as assists,
      coalesce(sum(e.yellow), 0)::bigint as yellow, coalesce(sum(e.red), 0)::bigint as red,
      mode() within group (order by tr.sport) as sport
    from public.match_player_participants mp
    join confirmed c on c.id = mp.match_id
    join public.tournaments tr on tr.id = c.tournament_id
    left join events e on e.match_id = mp.match_id and e.player_id = mp.player_id
    group by mp.player_id
  )
  select p.id, p.display_name, p.slug, p.photo_url, t.sport, team.name, team.slug,
    t.appearances, t.goals, t.assists, t.yellow, t.red
  from totals t
  join public.player_profiles p on p.id = t.player_id and p.is_published
  left join lateral (
    select tm.name, tm.slug from public.player_team_memberships ms
    join public.teams tm on tm.id = ms.team_id and tm.is_published
    where ms.player_id = p.id and ms.status = 'active'
    order by ms.effective_from desc nulls last limit 1
  ) team on true
  where t.appearances >= greatest(coalesce(p_min_appearances, 3), 1)
  order by t.appearances desc
  limit least(greatest(coalesce(p_limit, 60), 1), 200);
$$;
revoke execute on function public.get_public_top_players(text, integer, integer) from public;
grant execute on function public.get_public_top_players(text, integer, integer) to anon, authenticated, service_role;

-- 3. Registration window and places, as aggregates only ----------------------
-- Entry rows stay private; only counts of APPROVED entries leave the database.
-- team_limit_total is null when any category has no limit (places unknown).
create or replace function public.get_public_registration_capacity(p_tournament_ids uuid[])
returns table(tournament_id uuid, opens_at timestamptz, closes_at timestamptz, category_count bigint, team_limit_total bigint, approved_count bigint)
language sql stable security definer set search_path = public as $$
  select tr.id, rs.opens_at, rs.closes_at,
    (select count(*) from public.tournament_categories c where c.tournament_id = tr.id),
    (select case when count(*) = 0 or bool_or(c.team_limit is null) then null else sum(c.team_limit) end from public.tournament_categories c where c.tournament_id = tr.id)::bigint,
    (select count(*) from public.tournament_entries e where e.tournament_id = tr.id and e.application_status = 'approved')
  from public.tournaments tr
  left join public.tournament_registration_settings rs on rs.tournament_id = tr.id
  where tr.id = any(coalesce(p_tournament_ids, '{}')) and tr.is_published and tr.status <> 'draft'
  limit 60;
$$;
revoke execute on function public.get_public_registration_capacity(uuid[]) from public;
grant execute on function public.get_public_registration_capacity(uuid[]) to anon, authenticated, service_role;

-- 4. Service announcements (banner above the header) -------------------------
create table if not exists public.public_announcements (
  id uuid primary key default gen_random_uuid(),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title text not null check (length(trim(title)) between 1 and 160),
  title_dv text check (title_dv is null or length(title_dv) <= 160),
  body text check (body is null or length(body) <= 400),
  body_dv text check (body_dv is null or length(body_dv) <= 400),
  link_url text check (link_url is null or link_url ~ '^(https://|#)'),
  link_label text check (link_label is null or length(link_label) <= 40),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
alter table public.public_announcements enable row level security;
drop policy if exists "live announcements are public" on public.public_announcements;
create policy "live announcements are public" on public.public_announcements for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
drop policy if exists "platform admins manage announcements" on public.public_announcements;
create policy "platform admins manage announcements" on public.public_announcements for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create or replace function public.touch_public_announcement()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists touch_public_announcement_trigger on public.public_announcements;
create trigger touch_public_announcement_trigger before update on public.public_announcements for each row execute function public.touch_public_announcement();

-- 5. Content reports (private moderation requests) ---------------------------
-- Reporting never edits the record. Reporters are signed in, see only their
-- own reports, and are rate limited; nobody else but platform admins reads them.
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  entity_type text not null check (entity_type in ('tournament', 'team', 'player', 'match', 'news', 'organization')),
  entity_ref text not null check (length(entity_ref) between 1 and 200),
  entity_label text check (entity_label is null or length(entity_label) <= 200),
  reason text not null check (reason in ('incorrect_information', 'duplicate_player', 'impersonated_team', 'inappropriate_content', 'incorrect_match', 'privacy_concern', 'other')),
  details text check (details is null or length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  admin_note text check (admin_note is null or length(admin_note) <= 1000),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists content_reports_status_idx on public.content_reports(status, created_at desc);
create index if not exists content_reports_reporter_idx on public.content_reports(reporter_id, created_at desc);
alter table public.content_reports enable row level security;
drop policy if exists "reporters read own reports" on public.content_reports;
create policy "reporters read own reports" on public.content_reports for select to authenticated using (reporter_id = auth.uid());
drop policy if exists "platform admins read reports" on public.content_reports;
create policy "platform admins read reports" on public.content_reports for select to authenticated using (public.is_platform_admin());
drop policy if exists "platform admins resolve reports" on public.content_reports;
create policy "platform admins resolve reports" on public.content_reports for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
-- No insert policy: reports go through submit_content_report so limits apply.

create or replace function public.submit_content_report(p_entity_type text, p_entity_ref text, p_entity_label text, p_reason text, p_details text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if (select count(*) from public.content_reports r where r.reporter_id = auth.uid() and r.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'report_limit_reached';
  end if;
  if exists (select 1 from public.content_reports r where r.reporter_id = auth.uid() and r.entity_type = p_entity_type and r.entity_ref = p_entity_ref and r.status in ('open', 'reviewing')) then
    raise exception 'report_already_open';
  end if;
  insert into public.content_reports (reporter_id, entity_type, entity_ref, entity_label, reason, details)
  values (auth.uid(), p_entity_type, left(trim(p_entity_ref), 200), nullif(left(trim(coalesce(p_entity_label, '')), 200), ''), p_reason, nullif(left(trim(coalesce(p_details, '')), 1000), ''))
  returning id into new_id;
  return new_id;
end;
$$;
revoke execute on function public.submit_content_report(text, text, text, text, text) from public, anon;
grant execute on function public.submit_content_report(text, text, text, text, text) to authenticated, service_role;

create or replace function public.protect_content_report()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Admins change only the moderation fields; what was reported stays as sent.
  if new.reporter_id <> old.reporter_id or new.entity_type <> old.entity_type or new.entity_ref <> old.entity_ref
     or new.reason <> old.reason or coalesce(new.details, '') <> coalesce(old.details, '') or new.created_at <> old.created_at then
    raise exception 'report_contents_are_fixed';
  end if;
  if new.status in ('resolved', 'dismissed') and old.status not in ('resolved', 'dismissed') then
    new.resolved_by := auth.uid(); new.resolved_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists protect_content_report_trigger on public.content_reports;
create trigger protect_content_report_trigger before update on public.content_reports for each row execute function public.protect_content_report();

-- 6. Platform information pages (Privacy, Terms, guidelines…) ----------------
-- Legal text is the owner's to write; the app never invents it. Until a page
-- is published the site says so.
create table if not exists public.platform_pages (
  slug text primary key check (slug in ('privacy', 'terms', 'community-guidelines', 'child-safety', 'contact', 'account-deletion', 'image-consent', 'help', 'data-correction')),
  title text not null check (length(trim(title)) between 1 and 120),
  body text not null check (length(body) <= 20000),
  body_dv text check (body_dv is null or length(body_dv) <= 20000),
  is_published boolean not null default false,
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.platform_pages enable row level security;
drop policy if exists "published platform pages are public" on public.platform_pages;
create policy "published platform pages are public" on public.platform_pages for select to anon, authenticated using (is_published);
drop policy if exists "platform admins manage platform pages" on public.platform_pages;
create policy "platform admins manage platform pages" on public.platform_pages for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
