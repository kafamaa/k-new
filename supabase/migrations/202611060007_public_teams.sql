-- Make all teams publicly readable.
drop policy if exists "published teams are public" on public.teams;
create policy "teams are public" on public.teams for select using (true);
