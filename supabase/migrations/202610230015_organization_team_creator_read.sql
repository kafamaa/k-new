-- Workspace-creation RLS fix. Additive and review-only: do not apply to production
-- without explicit approval. Independent of the pending 014 review; filename order
-- means 014 must be applied first if both are approved.
--
-- Bug being fixed: the insert policies "organization creator assigns self owner" and
-- "team creator assigns self as manager" (202610210002) each require, inside their
-- WITH CHECK expression,
--   exists (select 1 from public.organizations/teams o where o.id = ... and o.created_by = auth.uid())
-- Subqueries inside policy expressions run as the current user and are subject to
-- row-level security on the referenced table. The only SELECT policies on
-- organizations and teams (202610210001) are the "published ... are public" ones,
-- which require the row to be published (new rows default to is_published = false)
-- or already linked to an existing membership row. A brand-new workspace is neither
-- visible to its creator nor yet a member of itself, so the exists() check is always
-- false and every "Create workspace" attempt fails with:
--   new row violates row-level security policy for table "organization_memberships"
--   (and identically for "team_memberships" when creating a Team).
--
-- Fix: let the signed-in creator read the workspace rows they created. created_by can
-- only equal their own auth.uid(), so no other account gains access; "to authenticated"
-- keeps the policies out of the anon policy set, and public guest pages keep using the
-- unchanged published-only policies. Tournament creation (202610210003) needs no change:
-- its operator checks read organization_memberships, which is visible once the owner
-- membership row exists.

create policy "creators read their organizations" on public.organizations for select to authenticated using (created_by = auth.uid());

create policy "creators read their teams" on public.teams for select to authenticated using (created_by = auth.uid());
