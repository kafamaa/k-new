-- Review-only. NOT APPLIED. Do not run against production without the owner's
-- explicit approval. Policy-only: no table, column, row, or function changes.
--
-- Defect being repaired (verified against live pg_policies on 2026-10-30):
-- these policies compare an unqualified column inside an EXISTS subquery, e.g.
--     exists (select 1 from organization_memberships om
--             where om.organization_id = organization_id and ...)
-- Postgres resolves the bare `organization_id` to the subquery's own table, so
-- the stored predicate is `om.organization_id = om.organization_id` - always
-- true. The policy then only checks "the caller has *some* membership", which
-- crosses organization / team boundaries. Live effect before this fix:
--   * tournaments: any member of any organization reads every tournament
--     (including other organizations' private drafts); any owner/operations
--     member of any organization can create tournaments for, and UPDATE,
--     any organization's tournaments.
--   * finance_receipts / finance_expenses: any owner/finance member of any
--     organization can read and write every organization's finance rows.
--   * news_articles: any owner/media/operations member of any organization can
--     manage any organization's news.
--   * organization_team_links: any organization member reads, and any
--     owner/operations member creates, links for every organization.
--   * player_team_memberships: any team member reads/updates/creates player
--     history for every team.
--   * match_player_participants: the "match has a confirmed result" condition
--     is satisfied by any confirmed result anywhere.
--
-- Each policy is recreated with the SAME name, command, roles and conditions;
-- the only change is qualifying the outer column with its table name so the
-- join means what it was written to mean. Nothing is widened.

-- tournaments --------------------------------------------------------------
drop policy if exists "organization operators read tournaments" on public.tournaments;
create policy "organization operators read tournaments" on public.tournaments for select using (
  exists (select 1 from public.organization_memberships om
          where om.organization_id = tournaments.organization_id and om.user_id = auth.uid())
);

drop policy if exists "organization operators create tournaments" on public.tournaments;
create policy "organization operators create tournaments" on public.tournaments for insert with check (
  created_by = auth.uid() and exists (
    select 1 from public.organization_memberships om
    where om.organization_id = tournaments.organization_id and om.user_id = auth.uid() and om.role in ('owner','operations')
  )
);

drop policy if exists "organization operators update tournaments" on public.tournaments;
create policy "organization operators update tournaments" on public.tournaments for update using (
  exists (select 1 from public.organization_memberships om
          where om.organization_id = tournaments.organization_id and om.user_id = auth.uid() and om.role in ('owner','operations'))
);

-- finance ------------------------------------------------------------------
drop policy if exists "finance staff manage receipts" on public.finance_receipts;
create policy "finance staff manage receipts" on public.finance_receipts for all to authenticated
  using (
    public.has_tournament_permission(tournament_id, 'finance')
    or exists (select 1 from public.organization_memberships om
               where om.organization_id = finance_receipts.organization_id and om.user_id = auth.uid() and om.role in ('owner','finance'))
  )
  with check (
    issued_by = auth.uid() and (
      public.has_tournament_permission(tournament_id, 'finance')
      or exists (select 1 from public.organization_memberships om
                 where om.organization_id = finance_receipts.organization_id and om.user_id = auth.uid() and om.role in ('owner','finance'))
    )
  );

drop policy if exists "finance staff manage expenses" on public.finance_expenses;
create policy "finance staff manage expenses" on public.finance_expenses for all to authenticated
  using (
    public.has_tournament_permission(tournament_id, 'finance')
    or (tournament_id is null and exists (select 1 from public.organization_memberships om
        where om.organization_id = finance_expenses.organization_id and om.user_id = auth.uid() and om.role in ('owner','finance')))
  )
  with check (
    created_by = auth.uid() and (
      public.has_tournament_permission(tournament_id, 'finance')
      or (tournament_id is null and exists (select 1 from public.organization_memberships om
          where om.organization_id = finance_expenses.organization_id and om.user_id = auth.uid() and om.role in ('owner','finance')))
    )
  );

-- news ---------------------------------------------------------------------
drop policy if exists "media roles manage organization news" on public.news_articles;
create policy "media roles manage organization news" on public.news_articles for all to authenticated
  using (
    (news_articles.organization_id is not null and exists (select 1 from public.organization_memberships om
      where om.organization_id = news_articles.organization_id and om.user_id = auth.uid() and om.role in ('owner','media','operations')))
    or (tournament_id is not null and (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'media')))
    or author_id = auth.uid()
  )
  with check (
    (news_articles.organization_id is not null and exists (select 1 from public.organization_memberships om
      where om.organization_id = news_articles.organization_id and om.user_id = auth.uid() and om.role in ('owner','media','operations')))
    or (tournament_id is not null and (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'media')))
    or author_id = auth.uid()
  );

-- organization team links --------------------------------------------------
drop policy if exists "organization operators read team links" on public.organization_team_links;
create policy "organization operators read team links" on public.organization_team_links for select using (
  exists (select 1 from public.organization_memberships om
          where om.organization_id = organization_team_links.organization_id and om.user_id = auth.uid())
);

drop policy if exists "organization operators create team links" on public.organization_team_links;
create policy "organization operators create team links" on public.organization_team_links for insert with check (
  linked_by = auth.uid() and exists (
    select 1 from public.organization_memberships om
    where om.organization_id = organization_team_links.organization_id and om.user_id = auth.uid() and om.role in ('owner','operations')
  )
);

-- player team memberships --------------------------------------------------
drop policy if exists "team managers read their player history" on public.player_team_memberships;
create policy "team managers read their player history" on public.player_team_memberships for select using (
  exists (select 1 from public.team_memberships tm
          where tm.team_id = player_team_memberships.team_id and tm.user_id = auth.uid())
);

drop policy if exists "team managers end player memberships" on public.player_team_memberships;
create policy "team managers end player memberships" on public.player_team_memberships for update to authenticated
  using (exists (select 1 from public.team_memberships tm
                 where tm.team_id = player_team_memberships.team_id and tm.user_id = auth.uid()))
  with check (exists (select 1 from public.team_memberships tm
                      where tm.team_id = player_team_memberships.team_id and tm.user_id = auth.uid()));

drop policy if exists "authorized users create player history" on public.player_team_memberships;
create policy "authorized users create player history" on public.player_team_memberships for insert with check (
  created_by = auth.uid() and (
    exists (select 1 from public.teams t where t.id = player_team_memberships.team_id and t.created_by = auth.uid())
    or exists (select 1 from public.team_memberships tm where tm.team_id = player_team_memberships.team_id and tm.user_id = auth.uid())
  )
);

-- match appearances --------------------------------------------------------
drop policy if exists "participants read confirmed appearances" on public.match_player_participants;
create policy "participants read confirmed appearances" on public.match_player_participants for select to authenticated using (
  exists (select 1 from public.match_result_versions rv
          where rv.match_id = match_player_participants.match_id and rv.status = 'confirmed')
  and (
    public.is_match_participant(match_id)
    or (
      exists (select 1 from public.player_profiles p where p.id = match_player_participants.player_id and p.is_published)
      and exists (select 1 from public.matches m join public.tournaments t on t.id = m.tournament_id
                  where m.id = match_player_participants.match_id and t.is_published)
    )
  )
);

drop policy if exists "players read own confirmed appearances" on public.match_player_participants;
create policy "players read own confirmed appearances" on public.match_player_participants for select to authenticated using (
  exists (select 1 from public.player_profiles p where p.id = match_player_participants.player_id and p.account_id = auth.uid())
  and exists (select 1 from public.match_result_versions rv
              where rv.match_id = match_player_participants.match_id and rv.status = 'confirmed')
);
