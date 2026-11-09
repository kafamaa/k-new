-- Helpers so the browser can publish a player or team without depending on
-- table-level update policies (which often block non-owners). Security definer.
create or replace function public.publish_player_profile(p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  update public.player_profiles set is_published = true where id = p_player_id;
end;
$$;
revoke execute on function public.publish_player_profile(uuid) from public, anon;
grant execute on function public.publish_player_profile(uuid) to authenticated, service_role;

create or replace function public.publish_team(p_team_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  update public.teams set is_published = true where id = p_team_id;
end;
$$;
revoke execute on function public.publish_team(uuid) from public, anon;
grant execute on function public.publish_team(uuid) to authenticated, service_role;
