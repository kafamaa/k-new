-- Backfill: convert any already-submitted (but unconfirmed) results to confirmed
-- and rebuild standings, so historical matches count immediately.
do $$
declare m record;
begin
  for m in select distinct match_id from public.match_result_versions where status = 'submitted' loop
    update public.match_result_versions set status = 'confirmed', confirmed_by = submitted_by where match_id = m.match_id and status = 'submitted';
    update public.matches set status = 'confirmed' where id = m.match_id;
  end loop;
end $$;

-- Rebuild standings for every stage that has matches.
do $$
declare s record;
begin
  for s in select distinct stage_id from public.matches where stage_id is not null loop
    perform public.recalculate_stage_standings(s.stage_id);
  end loop;
end $$;
