-- Review-only: the owner applies it. Additive; changes no existing table data.
--
-- 1) Sponsor deliverables (unified plan section 22): what the organizer owes
--    each sponsor - banners, logo placement, social posts, announcements,
--    hospitality - with a due date and a fulfilment state. Private to the
--    tournament's finance staff, like tournament_sponsors itself.
-- 2) Protests and appeals (unified plan section 23): a team manager of an
--    approved entry files a protest about a match or decision; the tournament's
--    organizers decide it with a written reason; a decided protest can be
--    appealed once. Nothing is deleted: a filer may withdraw while undecided.
--    Private to the organizers and the filing team; never on public pages.

-- 1 ---------------------------------------------------------------------------
create table if not exists public.tournament_sponsor_deliverables (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  sponsor_id uuid not null references public.tournament_sponsors(id) on delete cascade,
  kind text not null default 'other' check (kind in ('banner', 'logo_placement', 'social_post', 'announcement', 'hospitality', 'branded_item', 'other')),
  title text not null check (length(trim(title)) between 2 and 160),
  due_on date,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'waived')),
  note text check (note is null or length(note) <= 500),
  delivered_at timestamptz,
  delivered_by uuid references public.profiles(id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'delivered') = (delivered_at is not null))
);
create index if not exists tournament_sponsor_deliverables_idx on public.tournament_sponsor_deliverables(tournament_id, sponsor_id, due_on);
alter table public.tournament_sponsor_deliverables enable row level security;

-- The sponsor must belong to the same tournament as the deliverable.
create or replace function public.check_deliverable_sponsor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.tournament_sponsors s where s.id = new.sponsor_id and s.tournament_id = new.tournament_id) then
    raise exception 'sponsor_not_in_tournament';
  end if;
  new.updated_at := now();
  if new.status = 'delivered' and new.delivered_at is null then new.delivered_at := now(); new.delivered_by := auth.uid(); end if;
  if new.status <> 'delivered' then new.delivered_at := null; new.delivered_by := null; end if;
  return new;
end;
$$;
drop trigger if exists check_deliverable_sponsor on public.tournament_sponsor_deliverables;
create trigger check_deliverable_sponsor before insert or update on public.tournament_sponsor_deliverables
  for each row execute function public.check_deliverable_sponsor();

drop policy if exists "finance staff read deliverables" on public.tournament_sponsor_deliverables;
create policy "finance staff read deliverables" on public.tournament_sponsor_deliverables for select to authenticated
  using (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance'));
drop policy if exists "finance staff add deliverables" on public.tournament_sponsor_deliverables;
create policy "finance staff add deliverables" on public.tournament_sponsor_deliverables for insert to authenticated
  with check (created_by = (select auth.uid()) and (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance')));
drop policy if exists "finance staff update deliverables" on public.tournament_sponsor_deliverables;
create policy "finance staff update deliverables" on public.tournament_sponsor_deliverables for update to authenticated
  using (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance'))
  with check (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance'));
drop policy if exists "finance staff remove deliverables" on public.tournament_sponsor_deliverables;
create policy "finance staff remove deliverables" on public.tournament_sponsor_deliverables for delete to authenticated
  using (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance'));
grant select, insert, update, delete on public.tournament_sponsor_deliverables to authenticated;

-- 2 ---------------------------------------------------------------------------
create table if not exists public.tournament_protests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  team_id uuid not null references public.teams(id) on delete restrict,
  kind text not null check (kind in ('protest', 'appeal')),
  appeal_of uuid references public.tournament_protests(id) on delete restrict,
  subject text not null check (length(trim(subject)) between 5 and 160),
  grounds text not null check (length(trim(grounds)) between 20 and 4000),
  status text not null default 'submitted' check (status in ('submitted', 'under_review', 'upheld', 'rejected', 'withdrawn')),
  decision text check (decision is null or length(decision) <= 4000),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  filed_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'appeal') = (appeal_of is not null)),
  check ((status in ('upheld', 'rejected')) = (decided_at is not null))
);
create index if not exists tournament_protests_idx on public.tournament_protests(tournament_id, status, created_at desc);
create unique index if not exists tournament_protests_one_appeal on public.tournament_protests(appeal_of) where appeal_of is not null and status <> 'withdrawn';
alter table public.tournament_protests enable row level security;

-- Reads only; every change goes through the functions below.
drop policy if exists "organizers and filing team read protests" on public.tournament_protests;
create policy "organizers and filing team read protests" on public.tournament_protests for select to authenticated
  using (public.is_tournament_operator(tournament_id) or public.is_team_manager(team_id));
grant select on public.tournament_protests to authenticated;

create or replace function public.file_tournament_protest(p_tournament uuid, p_team uuid, p_match uuid, p_subject text, p_grounds text, p_appeal_of uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_parent public.tournament_protests;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if not public.is_team_manager(p_team) then raise exception 'team_manager_required'; end if;
  if not exists (select 1 from public.tournament_entries e where e.tournament_id = p_tournament and e.team_id = p_team and e.application_status = 'approved') then
    raise exception 'team_not_in_tournament';
  end if;
  if p_match is not null and not exists (select 1 from public.matches m where m.id = p_match and m.tournament_id = p_tournament) then
    raise exception 'match_not_in_tournament';
  end if;
  if p_subject is null or length(trim(p_subject)) < 5 then raise exception 'subject_required'; end if;
  if p_grounds is null or length(trim(p_grounds)) < 20 then raise exception 'grounds_required'; end if;
  if p_appeal_of is not null then
    select * into v_parent from public.tournament_protests where id = p_appeal_of;
    if v_parent.id is null or v_parent.tournament_id <> p_tournament or v_parent.team_id <> p_team then raise exception 'protest_not_found'; end if;
    if v_parent.kind <> 'protest' or v_parent.status not in ('upheld', 'rejected') then raise exception 'appeal_needs_decided_protest'; end if;
    if exists (select 1 from public.tournament_protests a where a.appeal_of = p_appeal_of and a.status <> 'withdrawn') then raise exception 'already_appealed'; end if;
  end if;
  insert into public.tournament_protests (tournament_id, match_id, team_id, kind, appeal_of, subject, grounds)
  values (p_tournament, coalesce(p_match, v_parent.match_id), p_team, case when p_appeal_of is null then 'protest' else 'appeal' end, p_appeal_of, left(trim(p_subject), 160), left(trim(p_grounds), 4000))
  returning id into v_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), case when p_appeal_of is null then 'protest_filed' else 'appeal_filed' end, 'tournament_protest', v_id, left(trim(p_subject), 500));
  return v_id;
end;
$$;
revoke execute on function public.file_tournament_protest(uuid, uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.file_tournament_protest(uuid, uuid, uuid, text, text, uuid) to authenticated, service_role;

-- Organizers move a protest to review or decide it; a decision needs a reason.
create or replace function public.decide_tournament_protest(p_protest uuid, p_status text, p_decision text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.tournament_protests;
begin
  select * into v_row from public.tournament_protests where id = p_protest for update;
  if v_row.id is null or not public.is_tournament_operator(v_row.tournament_id) then raise exception 'organizer_permission_required'; end if;
  if v_row.status in ('upheld', 'rejected', 'withdrawn') then raise exception 'already_closed'; end if;
  if p_status not in ('under_review', 'upheld', 'rejected') then raise exception 'invalid_status'; end if;
  if p_status in ('upheld', 'rejected') and (p_decision is null or length(trim(p_decision)) < 10) then raise exception 'decision_reason_required'; end if;
  update public.tournament_protests set status = p_status, updated_at = now(),
    decision = case when p_status = 'under_review' then decision else left(trim(p_decision), 4000) end,
    decided_by = case when p_status = 'under_review' then null else auth.uid() end,
    decided_at = case when p_status = 'under_review' then null else now() end
  where id = p_protest;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), 'protest_' || p_status, 'tournament_protest', p_protest, left(coalesce(trim(p_decision), ''), 500));
end;
$$;
revoke execute on function public.decide_tournament_protest(uuid, text, text) from public, anon;
grant execute on function public.decide_tournament_protest(uuid, text, text) to authenticated, service_role;

-- The filing team may withdraw while the protest is still open.
create or replace function public.withdraw_tournament_protest(p_protest uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.tournament_protests;
begin
  select * into v_row from public.tournament_protests where id = p_protest for update;
  if v_row.id is null or not public.is_team_manager(v_row.team_id) then raise exception 'protest_not_found'; end if;
  if v_row.status not in ('submitted', 'under_review') then raise exception 'already_closed'; end if;
  update public.tournament_protests set status = 'withdrawn', updated_at = now() where id = p_protest;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), 'protest_withdrawn', 'tournament_protest', p_protest, null);
end;
$$;
revoke execute on function public.withdraw_tournament_protest(uuid) from public, anon;
grant execute on function public.withdraw_tournament_protest(uuid) to authenticated, service_role;
