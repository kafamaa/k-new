-- Player profile details editable by the player: atoll, preferred foot/hand,
-- jersey number preference, short public biography and social media links.
-- Review-only; do not apply or push without explicit owner authorization.
--
-- These are optional public sports details. They are written through the
-- existing "players update own profile fields" policy (owner only) and are
-- public only when the profile itself is published. Private identity data
-- (date of birth, ID, contact details) stays in player_private_details.

alter table public.player_profiles
  add column if not exists atoll text check (atoll is null or length(atoll) <= 60),
  add column if not exists preferred_side text check (preferred_side is null or preferred_side in ('left', 'right', 'both')),
  add column if not exists jersey_number smallint check (jersey_number is null or jersey_number between 0 and 99),
  add column if not exists bio text check (bio is null or length(bio) <= 400),
  add column if not exists social_links jsonb not null default '{}'::jsonb check (jsonb_typeof(social_links) = 'object');

-- Social links may only point to the supported networks over https; the app
-- validates the same rule before saving.
create or replace function public.valid_social_links(p_links jsonb)
returns boolean language sql immutable as $$
  select coalesce(bool_and(
    key in ('instagram', 'facebook', 'tiktok', 'x', 'youtube')
    and jsonb_typeof(value) = 'string'
    and length(value #>> '{}') <= 200
    and (value #>> '{}') ~ '^https://([a-z0-9-]+\.)?(instagram\.com|facebook\.com|fb\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com|youtu\.be)/'
  ), true)
  from jsonb_each(p_links);
$$;

alter table public.player_profiles drop constraint if exists player_profiles_social_links_valid;
alter table public.player_profiles add constraint player_profiles_social_links_valid check (public.valid_social_links(social_links));
