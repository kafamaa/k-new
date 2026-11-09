-- Review-only. NOT APPLIED. Do not run against production without the owner's
-- explicit approval. Additive only: new table + RLS + indexes. No existing
-- table, policy, or column is altered. No seed data.
--
-- News, announcements and media (Product Specification section 3.3 / J).
-- Public reads are published-only; authoring is limited to organizer media
-- roles (has_tournament_permission 'media' or operations) or the owner of the
-- owning organization. Draft/scheduled/published/archived states are real.
-- Cover images and media links are stored as URLs; binary assets belong in
-- Storage buckets governed by separate (future) policies.
create table if not exists public.news_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  body text not null default '',
  content_type text not null default 'news' check (content_type in ('news','announcement','match_report','photo_gallery','video_link','highlight','organizer_update')),
  cover_image_url text,
  media_url text,
  tournament_id uuid references public.tournaments(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  author_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','scheduled','published','archived')),
  featured boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);
alter table public.news_articles enable row level security;
create index if not exists news_articles_status_idx on public.news_articles(status, published_at desc);
create index if not exists news_articles_tournament_idx on public.news_articles(tournament_id);
create index if not exists news_articles_organization_idx on public.news_articles(organization_id);

-- Public read: published rows only, and scheduled publication time has passed.
create policy "published news is public" on public.news_articles
  for select to anon, authenticated
  using (status = 'published' and (published_at is null or published_at <= now()));

-- Authors read their own drafts.
create policy "authors read own news" on public.news_articles
  for select to authenticated
  using (author_id = auth.uid());

-- Organization operators with media/operations/owner role manage news for
-- their organization. Tournament-scoped news is managed by tournament
-- operators or staff with the media permission.
create policy "media roles manage organization news" on public.news_articles
  for all to authenticated
  using (
    (organization_id is not null and exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','media','operations')))
    or (tournament_id is not null and (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'media')))
    or author_id = auth.uid()
  )
  with check (
    (organization_id is not null and exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','media','operations')))
    or (tournament_id is not null and (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'media')))
    or author_id = auth.uid()
  );
