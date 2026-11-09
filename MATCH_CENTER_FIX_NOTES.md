# Match Center fixes

## What changed

- Fixed the standings snapshot query used during result confirmation. Its `INSERT` named 11 columns but the `SELECT` returned only 10 values; the missing value was `p_stage_id`.
- Corrected the original `202611010045_tournament_engine.sql` migration for fresh database setups.
- Added `202611060001_match_center_standings_insert_fix.sql` as a forward migration for databases where migration 045 has already been applied.
- Updated Match Center to show every result awaiting confirmation, with a clearer score/review card.
- Added loading and result-fetch error states, preserved the database error message, and allowed retrying a failed confirmation.
- TypeScript type-check passes (`npm run typecheck`).

## Database action required

Apply the new migration `supabase/migrations/202611060001_match_center_standings_insert_fix.sql` to the Supabase database. Updating the project files alone does not change an already deployed database function.

## Build

Install dependencies and run `npm run build` before deploying the frontend. The supplied `node_modules`, generated `dist`, and `.env.local` were not included in this cleaned project archive; keep your environment variables in your local `.env.local` and do not commit secrets.
