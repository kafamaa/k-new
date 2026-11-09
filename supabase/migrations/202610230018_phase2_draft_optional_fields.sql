-- Tournament workflow Phase 2 (owner's "Complete Tournament Workflow: Creation
-- to Archive", 2026-10-23): optional creation-form fields.
--
-- The Phase 2 form "Only require: Tournament name, Sport. Optional when already
-- known: Season, Start date, Island/atoll."
--
--   * Season   - no new column. `tournaments.season_id` already exists,
--     added by `202610210008_histories_statistics.sql` (review-only) and
--     referencing `public.seasons(id) on delete set null`.
--   * Start date - new nullable `starts_at`. Kept on `date` because the
--     specification calls it a start *date* and validates a date range; the
--     later Stage 1 (Phase 3) migration can widen it if day precision is not
--     enough. No end date here: end dates arrive with Stage 1 per the same
--     one-migration-per-phase decision.
--   * Island/atoll - new nullable free-text `island`. Maldivian atoll and
--     island names are alphanumeric (Te'n, HA Ihavandhu), so plain text is the
--     honest shape; no reference table exists to constrain it.
--
-- Everything is nullable, so no existing row, policy, or query changes value or
-- behaviour. No policy, table, or privilege is touched. Nothing is seeded.
--
-- Review-only. Apply in the Supabase Dashboard SQL Editor.

alter table public.tournaments
  add column if not exists starts_at date,
  add column if not exists island text;
