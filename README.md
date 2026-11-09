# Kulhivaru+

Mobile-first React + TypeScript + Vite application for Maldives sports operations and public histories.

## Local development

```bash
npm install
npm run dev
```

Checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` plus `VITE_SUPABASE_PUBLISHABLE_KEY`. The browser client uses only the publishable key. Never place a service-role key in this file or source code.

## Owner testing

Use the owner’s existing Supabase account; this project does not seed demo users or sports records. Sign in from the homepage, verify the session-aware Workspace link, sign out, and confirm the public page remains view-only. For write testing, use only an authorized genuine draft and consenting participants. Recovery and verified-email testing use Supabase’s normal email flow.

The foundation migration at `supabase/migrations/202610210001_foundation.sql` is review-only and has not been applied to production. Review it against the live schema before deployment.

See `docs/OWNER_TESTING_GUIDE.md` for real-account acceptance testing. Email notifications remain queued until an approved provider is configured; queued is not delivered.
