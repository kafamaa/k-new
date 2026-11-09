-- Reviewed, additive foundation migration. Do not apply to production without explicit authorization.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null default '',
  avatar_url text,
  phone text,
  locale text not null default 'en',
  timezone text not null default 'Indian/Maldives',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles are readable by owner" on public.profiles for select using (auth.uid() = id);
create policy "users create own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "users update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  description text, is_published boolean not null default false, created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('owner','staff','finance','operations','media')),
  created_at timestamptz not null default now(), primary key (organization_id, user_id)
);
alter table public.organizations enable row level security; alter table public.organization_memberships enable row level security;
create policy "published organizations are public" on public.organizations for select using (is_published or exists (select 1 from public.organization_memberships m where m.organization_id = id and m.user_id = auth.uid()));
create policy "members read memberships" on public.organization_memberships for select using (user_id = auth.uid());

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  team_type text not null default 'club' check (team_type in ('club','island','national','school','other')),
  island text, description text, logo_url text, is_published boolean not null default false,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), deactivated_at timestamptz
);
create table if not exists public.team_memberships (
  team_id uuid not null references public.teams(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('manager','staff')), created_at timestamptz not null default now(), primary key (team_id, user_id)
);
alter table public.teams enable row level security; alter table public.team_memberships enable row level security;
create policy "published teams are public" on public.teams for select using (is_published or exists (select 1 from public.team_memberships m where m.team_id = id and m.user_id = auth.uid()));
create policy "team members read memberships" on public.team_memberships for select using (user_id = auth.uid());

create table if not exists public.player_profiles (
  id uuid primary key default gen_random_uuid(), display_name text not null, slug text not null unique, island text,
  photo_url text, is_claimed boolean not null default false, is_published boolean not null default false,
  account_id uuid unique references public.profiles(id) on delete set null, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), deactivated_at timestamptz
);
alter table public.player_profiles enable row level security;
create policy "published players are public" on public.player_profiles for select using (is_published or account_id = auth.uid());

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id), action text not null,
  entity_type text not null, entity_id uuid not null, reason text, created_at timestamptz not null default now()
);
alter table public.audit_events enable row level security;
create policy "users read own audit events" on public.audit_events for select using (actor_id = auth.uid());
