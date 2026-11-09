-- Review-only: the owner applies it. Additive.
--
-- Deleting a fixture that was added by mistake (unified plan sections 3 and 18).
-- Only an unplayed match can be deleted: status scheduled, postponed or
-- cancelled, with no result versions, events or recorded appearances. The
-- organizer gives a reason, which is kept in the tournament activity log with
-- the teams and time, so the deletion stays auditable. Played matches are
-- never deleted; they are corrected or marked abandoned instead.

-- Guard for any delete path, not only the function below.
create or replace function public.protect_played_match()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status not in ('scheduled', 'postponed', 'cancelled')
    or exists (select 1 from public.match_result_versions v where v.match_id = old.id)
    or exists (select 1 from public.match_events e where e.match_id = old.id)
    or exists (select 1 from public.match_player_participants p where p.match_id = old.id) then
    raise exception 'match_has_results';
  end if;
  return old;
end;
$$;
drop trigger if exists protect_played_match_trigger on public.matches;
create trigger protect_played_match_trigger before delete on public.matches for each row execute function public.protect_played_match();

create or replace function public.delete_fixture(p_match uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_match public.matches; v_home text; v_away text;
begin
  select * into v_match from public.matches where id = p_match for update;
  if v_match.id is null or not public.is_tournament_operator(v_match.tournament_id) then raise exception 'organizer_permission_required'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  select name into v_home from public.teams where id = v_match.home_team_id;
  select name into v_away from public.teams where id = v_match.away_team_id;
  perform public.log_tournament_event(v_match.tournament_id, 'match', v_match.id, 'fixture_deleted',
    jsonb_build_object('home', v_home, 'away', v_away, 'scheduled_at', v_match.scheduled_at, 'venue', v_match.venue, 'status', v_match.status),
    left(trim(p_reason), 500));
  begin
    delete from public.matches where id = p_match;
  exception when foreign_key_violation or restrict_violation then
    raise exception 'match_feeds_later_round';
  end;
end;
$$;
revoke execute on function public.delete_fixture(uuid, text) from public, anon;
grant execute on function public.delete_fixture(uuid, text) to authenticated, service_role;
