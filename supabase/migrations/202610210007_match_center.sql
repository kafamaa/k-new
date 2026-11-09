-- Stage 5 match-center trusted operations. Review-only; do not apply to production.
create or replace function public.record_match_event(
  p_match_id uuid, p_team_id uuid, p_player_id uuid, p_event_type text,
  p_event_minute integer, p_payload jsonb, p_idempotency_key uuid, p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare match_row public.matches; event_id uuid; allowed boolean := false; sport text;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select m.* into match_row from public.matches m where m.id = p_match_id for update;
  if match_row.id is null or not public.is_match_participant(p_match_id) then raise exception 'match_not_assigned'; end if;
  if match_row.status = 'confirmed' then raise exception 'match_already_confirmed'; end if;
  select t.sport into sport from public.tournaments t where t.id = match_row.tournament_id;
  allowed := case sport
    when 'football' then p_event_type in ('goal','assist','yellow_card','red_card','substitution','own_goal','unassigned_goal','shootout_score')
    when 'futsal' then p_event_type in ('goal','assist','yellow_card','red_card','substitution','team_foul','own_goal','unassigned_goal','shootout_score')
    when 'handball' then p_event_type in ('goal','assist','yellow_card','red_card','blue_card','two_minute_suspension')
    when 'volleyball' then p_event_type in ('point','ace','attack_point','block','dig','recorded_error')
    when 'basketball' then p_event_type in ('one_point','two_point','three_point','rebound','assist','steal','block','foul')
    when 'basketball_3x3' then p_event_type in ('one_point','two_point','rebound','assist','steal','block','foul')
    else false end;
  if not allowed then raise exception 'unsupported_event_type'; end if;
  insert into public.match_events(match_id, team_id, player_id, event_type, event_minute, payload, recorded_by, idempotency_key)
    values (p_match_id, p_team_id, p_player_id, p_event_type, p_event_minute, p_payload, p_actor_id, p_idempotency_key)
    on conflict (match_id, idempotency_key) do nothing returning id into event_id;
  if event_id is null then select id into event_id from public.match_events where match_id = p_match_id and idempotency_key = p_idempotency_key; end if;
  return event_id;
end;
$$;
revoke execute on function public.record_match_event(uuid, uuid, uuid, text, integer, jsonb, uuid, uuid) from public, anon;
grant execute on function public.record_match_event(uuid, uuid, uuid, text, integer, jsonb, uuid, uuid) to authenticated, service_role;

create or replace function public.submit_match_result(p_match_id uuid, p_score jsonb, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare next_version integer; result_id uuid; match_row public.matches;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select * into match_row from public.matches where id = p_match_id for update;
  if match_row.id is null or not public.is_match_participant(p_match_id) or match_row.status = 'confirmed' then raise exception 'result_not_allowed'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.match_result_versions where match_id = p_match_id;
  insert into public.match_result_versions(match_id, version, score, status, submitted_by) values (p_match_id, next_version, p_score, 'submitted', p_actor_id) returning id into result_id;
  update public.matches set status = 'awaiting_confirmation' where id = p_match_id;
  return result_id;
end;
$$;
revoke execute on function public.submit_match_result(uuid, jsonb, uuid) from public, anon;
grant execute on function public.submit_match_result(uuid, jsonb, uuid) to authenticated, service_role;

create or replace function public.confirm_match_result(p_result_id uuid, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare result_row public.match_result_versions; match_row public.matches;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select * into result_row from public.match_result_versions where id = p_result_id for update;
  select * into match_row from public.matches where id = result_row.match_id for update;
  if result_row.id is null or match_row.id is null or not public.is_tournament_operator(match_row.tournament_id) or result_row.status <> 'submitted' then raise exception 'confirmation_not_allowed'; end if;
  update public.match_result_versions set status = 'confirmed', confirmed_by = p_actor_id where id = p_result_id;
  update public.matches set status = 'confirmed' where id = match_row.id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (p_actor_id, 'match_result_confirmed', 'match_result_version', p_result_id, 'Organizer confirmation');
  return p_result_id;
end;
$$;
revoke execute on function public.confirm_match_result(uuid, uuid) from public, anon;
grant execute on function public.confirm_match_result(uuid, uuid) to authenticated, service_role;

create or replace function public.correct_match_result(p_match_id uuid, p_score jsonb, p_reason text, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare next_version integer; result_id uuid; match_row public.matches;
begin
  if p_actor_id <> auth.uid() or nullif(trim(p_reason), '') is null then raise exception 'correction_reason_required'; end if;
  select * into match_row from public.matches where id = p_match_id for update;
  if match_row.id is null or not public.is_tournament_operator(match_row.tournament_id) then raise exception 'correction_not_allowed'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.match_result_versions where match_id = p_match_id;
  update public.match_result_versions set status = 'rejected', correction_reason = trim(p_reason) where match_id = p_match_id and status = 'confirmed';
  insert into public.match_result_versions(match_id, version, score, status, submitted_by, confirmed_by, correction_reason) values (p_match_id, next_version, p_score, 'confirmed', p_actor_id, p_actor_id, trim(p_reason)) returning id into result_id;
  update public.matches set status = 'confirmed' where id = p_match_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (p_actor_id, 'match_result_corrected', 'match_result_version', result_id, trim(p_reason));
  return result_id;
end;
$$;
revoke execute on function public.correct_match_result(uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.correct_match_result(uuid, jsonb, text, uuid) to authenticated, service_role;
