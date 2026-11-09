-- Auto-publish players and teams when they are created or added anywhere in the app.
-- This removes the separate "publish" step for normal squad/team/player flows.
alter table public.player_profiles alter column is_published set default true;
alter table public.teams alter column is_published set default true;

update public.player_profiles set is_published = true where is_published is not true;
update public.teams set is_published = true where is_published is not true;
