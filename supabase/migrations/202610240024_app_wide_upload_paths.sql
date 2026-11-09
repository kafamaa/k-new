-- Review-only. NOT APPLIED. Do not run against production without the owner's
-- explicit approval. Additive only: nullable path columns + one public-media
-- Storage bucket + narrowly scoped policies. No existing table/policy/column
-- is altered destructively. No seed data.
--
-- App-wide file upload system (path-based, never URL-based). Object *paths* are
-- stored; display URLs are generated at read time. The bucket is public for
-- reads of published media only; writes/deletes require ownership of the
-- related record.
alter table public.profiles add column if not exists avatar_path text;
alter table public.player_profiles add column if not exists photo_path text;
alter table public.teams add column if not exists logo_path text;
alter table public.teams add column if not exists cover_path text;
alter table public.organizations add column if not exists logo_path text;
alter table public.organizations add column if not exists cover_path text;
alter table public.news_articles add column if not exists cover_path text;

insert into storage.buckets (id, name, public)
values ('public-media', 'public-media', true)
on conflict (id) do nothing;

-- Owner of the account may write their own avatar path.
create policy "account avatar owner write" on storage.objects
  for all to authenticated
  using (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'accounts' and (storage.foldername(name))[2] = auth.uid()::text)
  with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'accounts' and (storage.foldername(name))[2] = auth.uid()::text);

-- Player owner may write their own photo.
create policy "player photo owner write" on storage.objects
  for all to authenticated
  using (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'players' and exists (select 1 from public.player_profiles p where p.id::text = (storage.foldername(name))[2] and p.account_id = auth.uid()))
  with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'players' and exists (select 1 from public.player_profiles p where p.id::text = (storage.foldername(name))[2] and p.account_id = auth.uid()));

-- Team manager may write team branding.
create policy "team branding manager write" on storage.objects
  for all to authenticated
  using (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'teams' and public.is_team_manager(((storage.foldername(name))[2])::uuid))
  with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'teams' and public.is_team_manager(((storage.foldername(name))[2])::uuid));

-- Organization owner/admin may write organization branding.
create policy "organization branding owner write" on storage.objects
  for all to authenticated
  using (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'organizations' and exists (select 1 from public.organization_memberships om where om.organization_id::text = (storage.foldername(name))[2] and om.user_id = auth.uid() and om.role in ('owner','admin')))
  with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'organizations' and exists (select 1 from public.organization_memberships om where om.organization_id::text = (storage.foldername(name))[2] and om.user_id = auth.uid() and om.role in ('owner','admin')));
