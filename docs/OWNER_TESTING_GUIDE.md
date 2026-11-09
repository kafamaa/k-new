# Kulhivaru+ owner testing guide

Updated: 21 October 2026

This guide uses the owner’s real Supabase account and genuine records they are authorized to manage. Do not create demo accounts, fabricate national IDs, upload unrelated documents, or test against live published records that should remain unchanged.

## Before testing

1. Use a local/preview deployment with the intended Supabase environment variables configured by the deployment owner:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
2. Confirm the deployment points to the intended non-production test environment before any write test. This repository has not applied migrations or production SQL.
3. Use a genuine draft tournament, real authorized team, and consenting participants. Keep published/live records read-only.
4. Never place passwords, recovery codes, national IDs, service-role keys, HMAC secrets, or invitation tokens in this guide or bug reports.

## Core checks

### Account and workspace

- Sign in with the owner’s existing verified account.
- Confirm only authorized organizations and teams appear in Workspace.
- Refresh and reopen the page; the profile and workspace data should persist.
- Sign out; confirm public pages remain view-only and private workspace controls disappear.
- Use account recovery only through the normal Supabase email flow.

### Organizer journey

- Create a private tournament draft in an authorized organization.
- Save setup steps 1–11 at different times and resume after refresh.
- Configure registration dates, application method, custom question, roster requirements, and documents.
- Submit a real team application, then verify application, roster, and payment statuses remain separate.
- Review the application as an authorized organizer: approve or request changes.
- Export only an authorized report; verify private identity data and private documents are absent.

### Team and player claims

- Use an existing authorized team or create one only when genuinely needed.
- Add a real unclaimed player record with consent.
- Deliver the one-time private invitation through a secure channel outside this guide.
- Have the real player sign in with their own verified account and claim the profile.
- Confirm team/tournament history remains attached and a second claim/account is rejected.
- Verify expired and revoked invitations cannot be used.

### Match and history journey

- Use an assigned official account and an authorized match.
- Record sport-specific events online and, where supported, queue one while offline.
- Reconnect and replay; confirm idempotent operations are not duplicated.
- Create a conflicting edit against a newer result and verify **Needs Review** appears without overwriting.
- Submit a result, then have an authorized organizer confirm it.
- Confirm standings, player statistics, team history, and milestones update only after confirmation.
- Correct the result only with authorization and a reason; verify the prior version/audit record and recalculated totals.

### Finance and notifications

- Create a genuine MVR expense or fee record in an authorized organization/tournament.
- Test submitted → approved/rejected and approved → refunded transitions with reasons/proof where required.
- Verify finance records are invisible to guests, unrelated teams, and staff without finance permission.
- Queue an in-app notification and verify recipient visibility.
- Email notifications remain **queued** until an email provider is configured; do not treat queued as delivered.

## Record defects

For each issue record: screen/URL, account role (not credentials), genuine record type/ID if safe, expected result, actual result, timestamp, device/browser, and whether it can be reproduced after refresh. Do not include passwords, tokens, national IDs, private documents, or service credentials.

## Current limitations

- Live Supabase RLS/Auth/Storage/persistence checks are blocked until Docker/Podman or an authorized connected Supabase environment is available.
- Email delivery is not configured. Required setup is an approved email provider, sender/domain verification, provider credential stored as an Edge Function secret, and a delivery callback/status policy. SMS and Telegram are intentionally out of release one.
