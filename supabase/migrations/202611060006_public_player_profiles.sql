-- Make all player profiles publicly readable.
drop policy if exists "published players are public" on public.player_profiles;
create policy "player profiles are public" on public.player_profiles for select using (true);
