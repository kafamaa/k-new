-- Simple Match Center: "Start Match" and its Undo.
-- REVIEW ONLY. Not applied. The owner applies it after review.
--
-- change_fixture (migration 036) lets an organizer schedule, postpone, cancel or
-- abandon a match, but not mark it as being played. This adds one narrow action:
-- a tournament operator or an assigned match official may move a scheduled match
-- to live, or move a live match with no submitted result back to scheduled
-- (the Undo of an accidental start). Nothing else on the match changes, and the
-- existing fixture trigger records the change in the tournament timeline.
-- Results still go only through submit_match_result and confirm_match_result.

create or replace function public.set_match_live(p_match uuid, p_live boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_match public.matches;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  select * into v_match from public.matches where id = p_match for update;
  if v_match.id is null or not (public.is_tournament_operator(v_match.tournament_id) or public.is_match_official(p_match)) then
    raise exception 'organizer_permission_required';
  end if;
  if p_live then
    if v_match.status <> 'scheduled' then raise exception 'match_not_startable'; end if;
    update public.matches set status = 'live' where id = p_match;
  else
    if v_match.status <> 'live' then raise exception 'match_not_live'; end if;
    if exists (select 1 from public.match_result_versions r where r.match_id = p_match) then raise exception 'result_already_submitted'; end if;
    update public.matches set status = 'scheduled' where id = p_match;
  end if;
end;
$$;
revoke execute on function public.set_match_live(uuid, boolean) from public, anon;
grant execute on function public.set_match_live(uuid, boolean) to authenticated, service_role;
