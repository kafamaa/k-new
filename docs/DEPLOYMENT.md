# Kulhivaru+ deployment guide

Prepared 3 November 2026. Hosting: Vercel (static site) + the existing Supabase project.
Every database step below is additive and is applied by the owner. Nothing here resets data.

## 0. Before you start

1. **Back up the database.** Supabase Dashboard → Database → Backups → create a backup (or confirm today's automatic one).
2. **Check migration 030's rebuilt function.** Part of `202610300030_player_workspace_complete.sql` was lost in a file-editing accident on 3 Nov and rebuilt. In the SQL Editor run:

   ```sql
   select pg_get_functiondef('public.get_player_workspace_matches(uuid)'::regprocedure);
   ```

   If it returns a definition, the live version is intact; compare it with the file and keep whichever is correct. Do **not** re-run 030 on the live database.
3. **See which migrations are applied:**

   ```sql
   select version, name from supabase_migrations.schema_migrations order by version;
   ```

   If the project was set up through the SQL Editor (not the CLI), this table may be empty; then check for each feature's tables instead (step 1 below lists them).

## 1. Database updates in this release

Apply in order in the SQL Editor (paste the file, run, check for "Success"):

| File | What it adds | Check after applying |
|---|---|---|
| `202611030046_sponsor_deliverables_and_protests.sql` | Sponsor checklist; protests and appeals | `select count(*) from public.tournament_protests;` returns 0 |
| `202611030047_public_coach_referee_profiles.sql` | Opt-in public coach and referee profiles | `select * from public.get_public_people('referee');` returns no rows |

Until these are applied, the new screens show a "becomes available once the platform owner applies update 046/047" notice instead of failing.

Older migrations (044 discipline, 045 tournament engine and earlier) must already be applied; screens that depend on them show the same kind of notice.

### Rollback for 046 and 047 (only if needed)

```sql
-- 047
drop function if exists public.get_public_person(uuid);
drop function if exists public.get_public_people(text, text, integer, integer);
drop function if exists public.save_public_person_profile(text, boolean, text, text, text);
drop function if exists public.get_my_public_person_profiles();
drop function if exists public.person_holds_role(uuid, text);
drop table if exists public.public_person_profiles;
-- 046
drop function if exists public.withdraw_tournament_protest(uuid);
drop function if exists public.decide_tournament_protest(uuid, text, text);
drop function if exists public.file_tournament_protest(uuid, uuid, uuid, text, text, uuid);
drop table if exists public.tournament_protests;
drop trigger if exists check_deliverable_sponsor on public.tournament_sponsor_deliverables;
drop function if exists public.check_deliverable_sponsor();
drop table if exists public.tournament_sponsor_deliverables;
```

Rolling back deletes any protests, deliverables or public profiles recorded since. Export them first if they matter.

## 2. Edge Functions

Deploy with the Supabase CLI from this folder (`supabase login`, then `supabase link --project-ref <your project ref>`):

| Function | Secrets it needs | Command |
|---|---|---|
| `register-identity` | `IDENTITY_HMAC_SECRET` | `supabase functions deploy register-identity` |
| `claim-player`, `invite-player`, `revoke-player-invitation`, `invite-workspace-member`, `accept-workspace-invitation` | `CLAIM_TOKEN_HMAC_SECRET` | `supabase functions deploy <name>` |
| `public-api` (new, read-only) | none beyond the defaults | `supabase functions deploy public-api --no-verify-jwt` |

Set secrets once with `supabase secrets set IDENTITY_HMAC_SECRET=... CLAIM_TOKEN_HMAC_SECRET=...` (long random values; keep a private copy - changing them invalidates existing digests and invitations). `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.

`public-api` uses only the anonymous key, so it can never return more than a signed-out visitor sees. Endpoints:
`/functions/v1/public-api/v1/tournaments`, `.../v1/tournaments/{slug}`, `.../results`, `.../standings`, `.../v1/teams`, `.../v1/teams/{slug}`.
It allows 120 requests per minute per caller per function instance.

## 3. Website (Vercel)

1. Import this folder as a Vercel project (framework: Vite; `vercel.json` sets the build and headers).
2. Environment variables (Production and Preview):
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = the **publishable/anon** key. Never the service-role key.
3. Supabase Dashboard → Authentication → URL Configuration: add the Vercel domain to **Site URL** and **Redirect URLs** (needed for email verification and password reset).
4. Deploy. Rollback = Vercel → Deployments → previous deployment → Promote.

## 4. Smoke test after deploying (about 15 minutes)

Signed out, on a phone:
- Home, Tournaments, Matches, Teams, Players, News, Coaches, Referees open; no sideways scrolling.
- Switch to ދިވެހި: menus, footer and sign-in turn Dhivehi and right-to-left.
- Times on a published match show Maldives time (a 15:00 match shows 15:00, not 16:00).
- A private draft tournament's address shows "not found", not its data.

Signed in as organizer (your own account, a genuine draft tournament):
- Create a tournament with only name and sport; reload; it is still there.
- Matches screen shows "Protests and appeals"; Finance shows "Sponsor checklist" once a sponsor exists.
- Scheduling: change "Minimum rest for a team", save fixtures, reopen - your value is kept.
- Export a CSV and open it in Excel: names starting with `=` show as text.

Signed in as a team manager of an approved entry: Fixtures → "File a protest" works; the organizer sees it and can decide it with a reason.

Signed in as an official: record an event offline, sign out, sign in as another account on the same device - the first account's queued events are not shown.

## 5. Known limits in this release

- Dhivehi covers the shell, menus, sign-in, footer and all status labels. Page bodies are still English, and the Dhivehi wording is a draft that needs a native speaker's review.
- The rate limit on `public-api` is per function instance, not a global quota.
- No Content-Security-Policy header yet; add one after testing it against the live Supabase and Google Fonts domains.
- Swiss and double-elimination formats are not built (plan section 32.2: schedule explicitly).
- Signed-in journeys, offline replay and database access rules have not been tested in a browser against the live project; that needs the owner's accounts.
