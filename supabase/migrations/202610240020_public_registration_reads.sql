-- 2026-10-24 — Migration 020 (REVIEW-ONLY: apply in the Supabase Dashboard SQL
-- Editor, like 017-019; this file is never applied by the app).
--
-- Public reads for the applicant-facing registration information on the public
-- tournament page (spec section 6): state, dates, requirements, form questions,
-- and the category choice. Only *published* tournaments expose them — a draft
-- keeps its planning private by construction, matching the questions policy
-- "published registration questions are public" (already shipped in the base
-- schema; this migration does not touch it).
--
-- Column boundary note: `tournament_registration_settings` holds only
-- applicant-facing fields (dates, method, requirements, contact instructions,
-- roster limits, documents flag, change rules) plus `updated_by`, a profile id
-- with no name content. If the owner prefers, a narrow view is a later hardening
-- step; the row-level policy is the minimal change that makes the public page
-- work without restructuring.

-- 1. Registration settings readable to the public for published tournaments ---
create policy "published registration settings are public"
  on public.tournament_registration_settings
  for select
  using (exists (select 1 from public.tournaments t where t.id = tournament_id and t.is_published));

-- 2. Categories readable to the public for published tournaments ---------------
-- Applicants must be able to see the category list (with per-category team
-- caps) to pick one; eligibility instructions stay in `tournament_categories`
-- and are read with the same row.
create policy "published tournament categories are public"
  on public.tournament_categories
  for select
  using (exists (select 1 from public.tournaments t where t.id = tournament_id and t.is_published));
