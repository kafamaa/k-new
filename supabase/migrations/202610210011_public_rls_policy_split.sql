-- Public RLS policy split. Review-only; do not apply without explicit authorization.
-- Keep is_tournament_operator/is_match_participant unavailable to anon. Policies
-- that call them are authenticated-only; published reads remain separate.

-- Registration policies that call scoped helper functions.
drop policy if exists "operators manage setup steps" on public.tournament_setup_steps;
create policy "operators manage setup steps" on public.tournament_setup_steps for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "operators manage registration settings" on public.tournament_registration_settings;
create policy "operators manage registration settings" on public.tournament_registration_settings for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "operators manage registration questions" on public.tournament_registration_questions;
create policy "operators manage registration questions" on public.tournament_registration_questions for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "operators read entries" on public.tournament_entries;
create policy "operators read entries" on public.tournament_entries for select to authenticated using (public.is_tournament_operator(tournament_id));
drop policy if exists "team managers read own entries" on public.tournament_entries;
create policy "team managers read own entries" on public.tournament_entries for select to authenticated using (public.is_team_manager(team_id));
drop policy if exists "team managers submit applications" on public.tournament_entries;
create policy "team managers submit applications" on public.tournament_entries for insert to authenticated with check (public.is_team_manager(team_id) and exists (select 1 from public.tournaments t left join public.tournament_registration_settings rs on rs.tournament_id = t.id where t.id = tournament_id and t.status = 'registration_open' and coalesce(rs.application_method, 'team_application') in ('team_application','both')));
drop policy if exists "operators add tournament entries" on public.tournament_entries;
create policy "operators add tournament entries" on public.tournament_entries for insert to authenticated with check (public.is_tournament_operator(tournament_id));
drop policy if exists "team managers update own applications" on public.tournament_entries;
create policy "team managers update own applications" on public.tournament_entries for update to authenticated using (public.is_team_manager(team_id)) with check (public.is_team_manager(team_id));
drop policy if exists "operators review entries" on public.tournament_entries;
create policy "operators review entries" on public.tournament_entries for update to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "entry participants read answers" on public.tournament_registration_answers;
create policy "entry participants read answers" on public.tournament_registration_answers for select to authenticated using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
drop policy if exists "entry participants write answers" on public.tournament_registration_answers;
create policy "entry participants write answers" on public.tournament_registration_answers for all to authenticated using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id)))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
drop policy if exists "participants read rosters" on public.roster_submissions;
create policy "participants read rosters" on public.roster_submissions for select to authenticated using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
drop policy if exists "participants write rosters" on public.roster_submissions;
create policy "participants write rosters" on public.roster_submissions for all to authenticated using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id)))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
drop policy if exists "participants read roster players" on public.roster_submission_players;
create policy "participants read roster players" on public.roster_submission_players for select to authenticated using (exists (select 1 from public.roster_submissions r where r.id = submission_id));
drop policy if exists "participants write roster players" on public.roster_submission_players;
create policy "participants write roster players" on public.roster_submission_players for all to authenticated using (exists (select 1 from public.roster_submissions r where r.id = submission_id)) with check (exists (select 1 from public.roster_submissions r where r.id = submission_id));
drop policy if exists "operators manage fees" on public.tournament_fees;
create policy "operators manage fees" on public.tournament_fees for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "operators manage payments" on public.tournament_payments;
create policy "operators manage payments" on public.tournament_payments for all to authenticated using (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_tournament_operator(e.tournament_id))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_tournament_operator(e.tournament_id)));
drop policy if exists "team managers read payments" on public.tournament_payments;
create policy "team managers read payments" on public.tournament_payments for select to authenticated using (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id)));
drop policy if exists "private documents are scoped" on public.private_documents;
create policy "private documents are scoped" on public.private_documents for all to authenticated using (public.is_tournament_operator(tournament_id) or exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id))) with check (uploaded_by = auth.uid() and (public.is_tournament_operator(tournament_id) or exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id))));
drop policy if exists "authorized users upload tournament documents" on storage.objects;
create policy "authorized users upload tournament documents" on storage.objects for insert to authenticated with check (bucket_id = 'tournament-private-documents' and (public.is_tournament_operator((storage.foldername(name))[1]::uuid) or exists (select 1 from public.tournament_entries e where e.id = (storage.foldername(name))[2]::uuid and public.is_team_manager(e.team_id))));
drop policy if exists "authorized users read tournament documents" on storage.objects;
create policy "authorized users read tournament documents" on storage.objects for select to authenticated using (bucket_id = 'tournament-private-documents' and (public.is_tournament_operator((storage.foldername(name))[1]::uuid) or exists (select 1 from public.tournament_entries e where e.id = (storage.foldername(name))[2]::uuid and public.is_team_manager(e.team_id))));

-- Competition/match policies. Published reads from migrations 005 remain
-- independent of these authenticated-only operator/participant policies.
drop policy if exists "operators manage competition setup" on public.tournament_categories;
create policy "operators manage competition setup" on public.tournament_categories for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "operators manage stages" on public.competition_stages;
create policy "operators manage stages" on public.competition_stages for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "operators manage fixture versions" on public.competition_fixture_versions;
create policy "operators manage fixture versions" on public.competition_fixture_versions for all to authenticated using (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id))) with check (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id)));
drop policy if exists "operators manage groups" on public.competition_groups;
create policy "operators manage groups" on public.competition_groups for all to authenticated using (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id))) with check (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id)));
drop policy if exists "operators manage matches" on public.matches;
create policy "operators manage matches" on public.matches for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "assigned officials read matches" on public.matches;
create policy "assigned officials read matches" on public.matches for select to authenticated using (public.is_match_participant(id));
drop policy if exists "operators manage assignments" on public.match_official_assignments;
create policy "operators manage assignments" on public.match_official_assignments for all to authenticated using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));
drop policy if exists "assigned officials manage events" on public.match_events;
create policy "assigned officials manage events" on public.match_events for all to authenticated using (public.is_match_participant(match_id)) with check (recorded_by = auth.uid() and public.is_match_participant(match_id));
drop policy if exists "participants read results" on public.match_result_versions;
create policy "participants read results" on public.match_result_versions for select to authenticated using (public.is_match_participant(match_id));
drop policy if exists "officials submit results" on public.match_result_versions;
create policy "officials submit results" on public.match_result_versions for insert to authenticated with check (submitted_by = auth.uid() and public.is_match_participant(match_id));
drop policy if exists "operators confirm results" on public.match_result_versions;
create policy "operators confirm results" on public.match_result_versions for update to authenticated using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));
drop policy if exists "operators manage standings" on public.standings_snapshots;
create policy "operators manage standings" on public.standings_snapshots for all to authenticated using (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id))) with check (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id)));

drop policy if exists "assigned actors manage sync operations" on public.offline_sync_operations;
create policy "assigned actors manage sync operations" on public.offline_sync_operations for all to authenticated using (actor_id = auth.uid() and public.is_match_participant(match_id)) with check (actor_id = auth.uid() and public.is_match_participant(match_id));
drop policy if exists "operators resolve sync conflicts" on public.offline_sync_operations;
create policy "operators resolve sync conflicts" on public.offline_sync_operations for update to authenticated using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));

drop policy if exists "participants read confirmed appearances" on public.match_player_participants;
create policy "participants read confirmed appearances" on public.match_player_participants for select to authenticated using (exists (select 1 from public.match_result_versions rv where rv.match_id = match_id and rv.status = 'confirmed') and (public.is_match_participant(match_id) or (exists (select 1 from public.player_profiles p where p.id = player_id and p.is_published) and exists (select 1 from public.matches m join public.tournaments t on t.id = m.tournament_id where m.id = match_id and t.is_published))));
drop policy if exists "operators manage participants" on public.match_player_participants;
create policy "operators manage participants" on public.match_player_participants for all to authenticated using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));

-- Stage 7 private policies are authenticated-only; notification recipient reads
-- and the published policies from earlier migrations stay public where intended.
drop policy if exists "operators manage tournament staff" on public.tournament_staff_assignments;
create policy "operators manage tournament staff" on public.tournament_staff_assignments for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (assigned_by = auth.uid() and public.is_tournament_operator(tournament_id));
drop policy if exists "finance staff manage expenses" on public.finance_expenses;
create policy "finance staff manage expenses" on public.finance_expenses for all to authenticated using (public.has_tournament_permission(tournament_id, 'finance') or (tournament_id is null and exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance')))) with check (created_by = auth.uid() and (public.has_tournament_permission(tournament_id, 'finance') or (tournament_id is null and exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance')))));
drop policy if exists "finance staff manage receipts" on public.finance_receipts;
create policy "finance staff manage receipts" on public.finance_receipts for all to authenticated using (public.has_tournament_permission(tournament_id, 'finance') or exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance'))) with check (issued_by = auth.uid() and (public.has_tournament_permission(tournament_id, 'finance') or exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance'))));
drop policy if exists "finance staff manage adjustments" on public.finance_adjustments;
create policy "finance staff manage adjustments" on public.finance_adjustments for all to authenticated using (exists (select 1 from public.tournament_payments p join public.tournament_entries e on e.id = p.entry_id where p.id = payment_id and public.has_tournament_permission(e.tournament_id, 'finance'))) with check (approved_by = auth.uid());
drop policy if exists "authorized staff create notifications" on public.notifications;
create policy "authorized staff create notifications" on public.notifications for insert to authenticated with check (created_by = auth.uid() and (tournament_id is null or public.has_tournament_permission(tournament_id, 'operations')));
