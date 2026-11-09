-- Stage 3 first slice: private, resumable tournament drafts.
-- Additive and review-only; do not apply to production without authorization.
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  slug text not null unique,
  sport text not null check (sport in ('football','futsal','handball','volleyball','basketball','basketball_3x3')),
  status text not null default 'draft' check (status in ('draft','setup','registration_open','registration_closed','in_progress','completed','archived','cancelled')),
  setup_stage smallint not null default 1 check (setup_stage between 1 and 11),
  is_published boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tournaments_organization_idx on public.tournaments(organization_id, updated_at desc);
alter table public.tournaments enable row level security;
create policy "published tournaments are public" on public.tournaments for select using (is_published and status <> 'draft');
create policy "organization operators read tournaments" on public.tournaments for select using (
  exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid())
);
create policy "organization operators create tournaments" on public.tournaments for insert with check (
  created_by = auth.uid() and exists (
    select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','operations')
  )
);
create policy "organization operators update tournaments" on public.tournaments for update using (
  exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','operations'))
);
