-- Review-only. NOT APPLIED. Do not run against production without the owner's
-- explicit approval. Additive only: two columns + one private Storage bucket +
-- self-scoped Storage policies. No existing table, policy, or column is altered
-- beyond the two new nullable columns. No seed data.
--
-- Tournament branding images (Stage 1 — Basics). Object *paths* are stored in
-- the database; expiring signed URLs are generated at read time and never
-- persisted. The bucket is private; public reads are mediated by the
-- tournament's published state (see the helper below), so draft branding stays
-- private.
alter table public.tournaments
  add column if not exists logo_path text,
  add column if not exists cover_path text;

-- Private bucket for tournament media. Created idempotently.
insert into storage.buckets (id, name, public)
values ('tournament-media', 'tournament-media', false)
on conflict (id) do nothing;

-- Helper: an organization operator (owner/operations) for the tournament's
-- organization may write/delete objects under
--   organizations/{organization_id}/tournaments/{tournament_id}/...
-- The path's first two segments must match an organization and tournament the
-- caller operates. Anonymous and cross-organization writes are impossible.
create or replace function public.tournament_media_write_allowed(p_object_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  org_id uuid;
  tourn_id uuid;
begin
  -- Object name: organizations/{org}/tournaments/{tourn}/logo|cover/{file}
  if p_object_name !~ '^organizations/[0-9a-f-]{36}/tournaments/[0-9a-f-]{36}/(logo|cover)/[A-Za-z0-9._-]+$' then
    return false;
  end if;
  org_id := (regexp_match(p_object_name, '^organizations/([0-9a-f-]{36})/'))[1]::uuid;
  tourn_id := (regexp_match(p_object_name, 'tournaments/([0-9a-f-]{36})/'))[1]::uuid;
  return exists (
    select 1 from public.tournaments t
    join public.organization_memberships om on om.organization_id = t.organization_id
    where t.id = tourn_id and t.organization_id = org_id
      and om.user_id = auth.uid() and om.role in ('owner','operations')
  );
end;
$$;
revoke execute on function public.tournament_media_write_allowed(text) from public, anon;
grant execute on function public.tournament_media_write_allowed(text) to authenticated, service_role;

-- Storage policies: only authorized operators write; only authorized operators
-- (and, for published tournaments, anyone via the read helper) read.
create policy "tournament media authorized upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tournament-media' and public.tournament_media_write_allowed(name));

create policy "tournament media authorized update" on storage.objects
  for update to authenticated
  using (bucket_id = 'tournament-media' and public.tournament_media_write_allowed(name))
  with check (bucket_id = 'tournament-media' and public.tournament_media_write_allowed(name));

create policy "tournament media authorized delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tournament-media' and public.tournament_media_write_allowed(name));

-- Read policy: authorized operators always; everyone else only when the
-- owning tournament is published (path is validated by the helper).
create policy "tournament media authorized read" on storage.objects
  for select to authenticated
  using (bucket_id = 'tournament-media' and public.tournament_media_write_allowed(name));

create policy "tournament media public read for published" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'tournament-media'
    and exists (
      select 1 from public.tournaments t
      where t.is_published = true
        and t.logo_path = name or t.cover_path = name
    )
  );
