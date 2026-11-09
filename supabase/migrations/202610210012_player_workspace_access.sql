-- Player workspace access additions. Review-only; do not apply or push without authorization.
-- The profile owner may read their own history and confirmed related records;
-- guests still receive only published public records through existing policies.
create policy "players read own team history" on public.player_team_memberships for select to authenticated using (exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
create policy "players read own confirmed appearances" on public.match_player_participants for select to authenticated using (exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()) and exists (select 1 from public.match_result_versions rv where rv.match_id = match_id and rv.status = 'confirmed'));
create policy "players read own confirmed matches" on public.matches for select to authenticated using (exists (select 1 from public.match_player_participants mp where mp.match_id = id and mp.player_id in (select p.id from public.player_profiles p where p.account_id = auth.uid())) and status = 'confirmed');
create policy "players read own milestones" on public.sport_milestones for select to authenticated using (player_id in (select p.id from public.player_profiles p where p.account_id = auth.uid()));
