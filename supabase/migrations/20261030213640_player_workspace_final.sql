-- ===========================================================================
-- Player Workspace, final specification (created with: supabase migration new player_workspace_final)
-- ===========================================================================
-- Review-only. Depends on 013, 026, 029 and 030 (it does not depend on 031–033).
--
--   1. Public player code (KHP-000184): a stable public identifier for the
--      digital card. It is not the database key, not the national ID, and it
--      cannot be changed once issued.
--   2. Request types for identity, roster, duplicate-profile, privacy,
--      data-copy and account-closure requests.
--   3. Player activity: a private log written by the database itself when
--      the player's own records change, so the history cannot be forged from
--      the browser. It records labels only — never claim tokens, national IDs,
--      file paths or other users' information.
--   4. Match availability: the player's own answer for an upcoming match.
--      A private reason is readable only by the player and the managers of
--      the team the player plays for in that match.
--   5. Digital card choices: published team shown, photo position and the
--      statistics row. The card itself is always built from official data.
-- ===========================================================================

-- 1. Public player code ----------------------------------------------------------
create sequence if not exists public.player_public_code_seq;
alter table public.player_profiles add column if not exists public_code text;

-- Existing players get codes in creation order.
with ordered as (
  select id from public.player_profiles where public_code is null order by created_at, id
)
update public.player_profiles p set public_code = 'KHP-' || lpad(nextval('public.player_public_code_seq')::text, 6, '0')
from ordered where p.id = ordered.id;

alter table public.player_profiles alter column public_code set default ('KHP-' || lpad(nextval('public.player_public_code_seq')::text, 6, '0'));
alter table public.player_profiles alter column public_code set not null;
create unique index if not exists player_profiles_public_code_key on public.player_profiles(public_code);

create or replace function public.protect_player_public_code()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.public_code is distinct from old.public_code then raise exception 'public_code_is_permanent'; end if;
  return new;
end;
$$;
drop trigger if exists protect_player_public_code_trigger on public.player_profiles;
create trigger protect_player_public_code_trigger before update of public_code on public.player_profiles for each row execute function public.protect_player_public_code();

-- 2. More request types ------------------------------------------------------------
alter table public.player_correction_requests drop constraint if exists player_correction_requests_request_type_check;
alter table public.player_correction_requests add constraint player_correction_requests_request_type_check
  check (request_type in ('profile', 'statistics', 'team_history', 'document', 'verification', 'impersonation', 'team_contact', 'organizer_contact', 'account_support',
    'identity', 'roster', 'duplicate_profile', 'privacy', 'data_copy', 'account_closure'));

-- 3. Player activity -----------------------------------------------------------------
create table if not exists public.player_activity (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event text not null check (event ~ '^[a-z_]{3,48}$'),
  detail text check (detail is null or length(detail) <= 160),
  created_at timestamptz not null default now()
);
create index if not exists player_activity_player_idx on public.player_activity(player_id, created_at desc);
alter table public.player_activity enable row level security;
drop policy if exists "players read own activity" on public.player_activity;
create policy "players read own activity" on public.player_activity for select to authenticated
  using (exists (select 1 from public.player_profiles p where p.id = player_activity.player_id and p.account_id = (select auth.uid())));
-- The only events the browser may add are the player's own card actions.
drop policy if exists "players log own card actions" on public.player_activity;
create policy "players log own card actions" on public.player_activity for insert to authenticated
  with check (actor_id = (select auth.uid()) and event in ('card_downloaded', 'card_shared', 'card_printed') and detail is null
    and exists (select 1 from public.player_profiles p where p.id = player_activity.player_id and p.account_id = (select auth.uid())));

create or replace function public.log_player_activity(p_player_id uuid, p_event text, p_detail text)
returns void language sql security definer set search_path = public as $$
  insert into public.player_activity(player_id, actor_id, event, detail) values (p_player_id, auth.uid(), p_event, left(p_detail, 160));
$$;
revoke execute on function public.log_player_activity(uuid, text, text) from public, anon, authenticated;

-- Profile: publish/unpublish, or a change to the sports profile.
create or replace function public.track_player_profile_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ignored text[] := array['updated_at', 'is_published', 'card_style', 'card_team_id', 'card_photo_y', 'card_stat_variant', 'account_id', 'public_code', 'is_claimed'];
begin
  if new.is_published is distinct from old.is_published then
    perform public.log_player_activity(new.id, case when new.is_published then 'profile_published' else 'profile_unpublished' end, null);
  end if;
  if new.account_id is distinct from old.account_id and new.account_id is not null then
    perform public.log_player_activity(new.id, 'profile_claimed', null);
  end if;
  if (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored) then
    perform public.log_player_activity(new.id, 'profile_updated', null);
  end if;
  return new;
end;
$$;
drop trigger if exists track_player_profile_activity_trigger on public.player_profiles;
create trigger track_player_profile_activity_trigger after update on public.player_profiles for each row execute function public.track_player_profile_activity();

-- Privacy: hiding or showing the biography (hidden_bio, migration 030).
create or replace function public.track_player_privacy_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (to_jsonb(new)->>'hidden_bio') is distinct from (to_jsonb(old)->>'hidden_bio') then
    perform public.log_player_activity(new.player_id, 'privacy_changed', case when to_jsonb(new)->>'hidden_bio' is null then 'Biography shown' else 'Biography hidden' end);
  end if;
  return new;
end;
$$;
drop trigger if exists track_player_privacy_activity_trigger on public.player_private_details;
create trigger track_player_privacy_activity_trigger after update on public.player_private_details for each row execute function public.track_player_privacy_activity();

-- Team invitations: the player's answer.
create or replace function public.track_player_invitation_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('accepted', 'declined', 'reported') then
    perform public.log_player_activity(new.player_id, 'invitation_' || new.status, (select t.name from public.teams t where t.id = new.team_id));
  end if;
  return new;
end;
$$;
drop trigger if exists track_player_invitation_activity_trigger on public.player_team_invitations;
create trigger track_player_invitation_activity_trigger after update on public.player_team_invitations for each row execute function public.track_player_invitation_activity();

-- Join requests: sent, and the team's decision.
create or replace function public.track_player_join_request_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_player_activity(new.player_id, 'join_request_submitted', (select t.name from public.teams t where t.id = new.team_id));
  elsif new.status is distinct from old.status then
    perform public.log_player_activity(new.player_id, 'join_request_' || new.status, (select t.name from public.teams t where t.id = new.team_id));
  end if;
  return new;
end;
$$;
drop trigger if exists track_player_join_request_activity_trigger on public.player_team_requests;
create trigger track_player_join_request_activity_trigger after insert or update on public.player_team_requests for each row execute function public.track_player_join_request_activity();

-- Documents: uploaded, reviewed, removed. The label is the document type, never the file path.
create or replace function public.track_player_document_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.player_id is not null then
    perform public.log_player_activity(new.player_id, 'document_uploaded', new.document_type);
  elsif tg_op = 'UPDATE' and new.player_id is not null and new.status is distinct from old.status then
    perform public.log_player_activity(new.player_id, 'document_' || new.status, new.document_type);
  elsif tg_op = 'DELETE' and old.player_id is not null then
    perform public.log_player_activity(old.player_id, 'document_removed', old.document_type);
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists track_player_document_activity_trigger on public.private_documents;
create trigger track_player_document_activity_trigger after insert or update or delete on public.private_documents for each row execute function public.track_player_document_activity();

-- Correction and other requests: sent, and each decision.
create or replace function public.track_player_request_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_player_activity(new.player_id, 'request_submitted', new.request_type);
  elsif new.status is distinct from old.status then
    perform public.log_player_activity(new.player_id, 'request_' || new.status, new.request_type);
  end if;
  return new;
end;
$$;
drop trigger if exists track_player_request_activity_trigger on public.player_correction_requests;
create trigger track_player_request_activity_trigger after insert or update on public.player_correction_requests for each row execute function public.track_player_request_activity();

-- 4. Match availability ------------------------------------------------------------------
create table if not exists public.player_match_availability (
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  status text not null check (status in ('available', 'unavailable', 'maybe', 'injured', 'suspended', 'other')),
  private_reason text check (private_reason is null or length(private_reason) <= 200),
  updated_at timestamptz not null default now(),
  primary key (player_id, match_id)
);
alter table public.player_match_availability enable row level security;

-- The player, for a match of a team they actively belong to, before it is played.
create or replace function public.can_set_match_availability(p_player_id uuid, p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.player_profiles p
    join public.matches m on m.id = p_match_id and m.status in ('scheduled', 'postponed')
    join public.player_team_memberships ms on ms.player_id = p.id and ms.status in ('active', 'loaned') and ms.team_id in (m.home_team_id, m.away_team_id)
    where p.id = p_player_id and p.account_id = auth.uid()
  );
$$;
revoke execute on function public.can_set_match_availability(uuid, uuid) from public, anon;
grant execute on function public.can_set_match_availability(uuid, uuid) to authenticated, service_role;

-- Team managers of the player's team in that match.
create or replace function public.manages_player_in_match(p_player_id uuid, p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.matches m
    join public.player_team_memberships ms on ms.player_id = p_player_id and ms.status in ('active', 'loaned') and ms.team_id in (m.home_team_id, m.away_team_id)
    where m.id = p_match_id and public.is_team_manager(ms.team_id)
  );
$$;
revoke execute on function public.manages_player_in_match(uuid, uuid) from public, anon;
grant execute on function public.manages_player_in_match(uuid, uuid) to authenticated, service_role;

drop policy if exists "players read own availability" on public.player_match_availability;
create policy "players read own availability" on public.player_match_availability for select to authenticated
  using (exists (select 1 from public.player_profiles p where p.id = player_match_availability.player_id and p.account_id = (select auth.uid())));
drop policy if exists "team managers read player availability" on public.player_match_availability;
create policy "team managers read player availability" on public.player_match_availability for select to authenticated
  using (public.manages_player_in_match(player_match_availability.player_id, player_match_availability.match_id));
drop policy if exists "players set own availability" on public.player_match_availability;
create policy "players set own availability" on public.player_match_availability for insert to authenticated
  with check (public.can_set_match_availability(player_match_availability.player_id, player_match_availability.match_id));
drop policy if exists "players change own availability" on public.player_match_availability;
create policy "players change own availability" on public.player_match_availability for update to authenticated
  using (public.can_set_match_availability(player_match_availability.player_id, player_match_availability.match_id))
  with check (public.can_set_match_availability(player_match_availability.player_id, player_match_availability.match_id));

-- 5. Digital card choices -------------------------------------------------------------------
alter table public.player_profiles
  add column if not exists card_team_id uuid references public.teams(id) on delete set null,
  add column if not exists card_photo_y smallint check (card_photo_y is null or card_photo_y between 0 and 100),
  add column if not exists card_stat_variant text check (card_stat_variant is null or card_stat_variant in ('attack', 'discipline'));

-- The card may only show a published team the player belongs (or belonged) to.
create or replace function public.protect_player_card_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.card_team_id is not null and new.card_team_id is distinct from old.card_team_id and not exists (
    select 1 from public.player_team_memberships ms join public.teams t on t.id = ms.team_id and t.is_published
    where ms.player_id = new.id and ms.team_id = new.card_team_id
  ) then
    raise exception 'card_team_not_allowed';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_player_card_team_trigger on public.player_profiles;
create trigger protect_player_card_team_trigger before update of card_team_id on public.player_profiles for each row execute function public.protect_player_card_team();
