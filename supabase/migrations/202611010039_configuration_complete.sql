-- Configuration and Customization Studio, the remaining parts.
-- Review-only. Do not apply, push or deploy without explicit owner authorization.
-- Apply after 202611010038_public_pages_complete.sql.
-- Created with `supabase migration new configuration_complete`, renamed from
-- 20261101185557_… to 202611010039_… to match the other migrations.
--
-- Only the configuration check (app_config_problem_for, from 035) changes; it is
-- recreated with every 035 rule unchanged plus these new, fixed fields:
--   Platform configuration
--     places:  atoll names, islands (with atoll) and venues (with island), used as
--              suggestions in island, atoll and venue fields;
--     uploads: lower image and document size limits (never above the storage limits);
--     legal:   a version label and effective date for each legal page.
--   Customization Studio (install)
--     pwa.appName, pwa.shortName, pwa.iconUrl (a PNG from the media library),
--     pwa.themeColor, pwa.backgroundColor: the installed app's name, icon and colours,
--     served by the site's service worker, so no rebuild is needed.
-- No table, column, policy or grant changes. Drafts, review and publishing are unchanged.

create or replace function public.app_config_problem_for(p_kind text, p_config jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_key text;
  v_value jsonb;
  v_section jsonb;
  v_nav constant text[] := array['tournaments', 'live', 'teams', 'players', 'news', 'organizations', 'matches', 'standings', 'bracket', 'how-it-works'];
  v_sports constant text[] := array['football', 'futsal', 'handball', 'volleyball', 'basketball', 'basketball_3x3'];
  v_legal constant text[] := array['privacy', 'terms', 'community-guidelines', 'child-safety', 'data-correction', 'account-deletion', 'image-consent'];
  v_item jsonb;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then return 'config_not_object'; end if;
  if octet_length(p_config::text) > 60000 then return 'config_too_large'; end if;
  if p_kind = 'appearance' then
    v_key := public.cfg_unknown_key(p_config, array['theme', 'landing', 'fonts', 'brand', 'navigation', 'templates', 'seo', 'pwa', 'translations']);
    if v_key is not null then return 'unknown_key:' || v_key; end if;
    -- theme and landing keep the 034 rules.
    v_key := public.app_config_problem(p_config - array['fonts', 'brand', 'navigation', 'templates', 'seo', 'pwa', 'translations']);
    if v_key is not null then return v_key; end if;
    v_section := p_config -> 'fonts';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['heading', 'body', 'dhivehi']) is not null then return 'invalid_fonts'; end if;
      if v_section ? 'heading' and (v_section ->> 'heading') not in ('space-grotesk', 'inter', 'poppins', 'montserrat', 'system') then return 'invalid_fonts'; end if;
      if v_section ? 'body' and (v_section ->> 'body') not in ('plus-jakarta', 'inter', 'noto-sans', 'system') then return 'invalid_fonts'; end if;
      if v_section ? 'dhivehi' and (v_section ->> 'dhivehi') not in ('noto-sans-thaana', 'system') then return 'invalid_fonts'; end if;
    end if;
    v_section := p_config -> 'brand';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['appName', 'tagline', 'copyright', 'supportEmail', 'logoUrl', 'logoAlt', 'social']) is not null then return 'invalid_brand'; end if;
      if v_section ? 'appName' and not (public.cfg_text_ok(v_section -> 'appName', 30) and length(trim(v_section ->> 'appName')) >= 2) then return 'invalid_brand_name'; end if;
      if v_section ? 'tagline' and not public.cfg_text_ok(v_section -> 'tagline', 80) then return 'invalid_brand_text'; end if;
      if v_section ? 'copyright' and not public.cfg_text_ok(v_section -> 'copyright', 80) then return 'invalid_brand_text'; end if;
      if v_section ? 'logoAlt' and not public.cfg_text_ok(v_section -> 'logoAlt', 80) then return 'invalid_brand_text'; end if;
      if v_section ? 'supportEmail' and not (jsonb_typeof(v_section -> 'supportEmail') = 'string' and (v_section ->> 'supportEmail') ~ '^[^@\s<>]{1,64}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,}$') then return 'invalid_email'; end if;
      if v_section ? 'logoUrl' and not public.cfg_media_ok(v_section -> 'logoUrl') then return 'invalid_logo'; end if;
      if v_section ? 'logoUrl' and not (v_section ? 'logoAlt') then return 'logo_alt_required'; end if;
      if v_section ? 'social' then
        if jsonb_typeof(v_section -> 'social') <> 'array' or jsonb_array_length(v_section -> 'social') > 6 then return 'invalid_social'; end if;
        for v_value in select * from jsonb_array_elements(v_section -> 'social') loop
          if jsonb_typeof(v_value) <> 'object' or public.cfg_unknown_key(v_value, array['label', 'url']) is not null
            or (v_value ->> 'label') not in ('Facebook', 'Instagram', 'X', 'YouTube', 'TikTok', 'Website') or not public.cfg_https_ok(v_value -> 'url', 200) then return 'invalid_social'; end if;
        end loop;
      end if;
    end if;
    v_section := p_config -> 'navigation';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['hidden', 'order', 'labels']) is not null then return 'invalid_navigation'; end if;
      if v_section ? 'hidden' and not public.cfg_id_list_ok(v_section -> 'hidden', v_nav, 10) then return 'invalid_navigation'; end if;
      if v_section ? 'order' and not public.cfg_id_list_ok(v_section -> 'order', v_nav, 10) then return 'invalid_navigation'; end if;
      if v_section ? 'labels' then
        if jsonb_typeof(v_section -> 'labels') <> 'object' or public.cfg_unknown_key(v_section -> 'labels', v_nav) is not null then return 'invalid_navigation'; end if;
        for v_key, v_value in select * from jsonb_each(v_section -> 'labels') loop
          if not (public.cfg_text_ok(v_value, 24) and length(trim(v_value #>> '{}')) >= 2) then return 'invalid_navigation_label'; end if;
        end loop;
      end if;
    end if;
    v_section := p_config -> 'templates';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['publicHero', 'cards', 'density']) is not null then return 'invalid_templates'; end if;
      if v_section ? 'publicHero' and (v_section ->> 'publicHero') not in ('standard', 'compact', 'image-led') then return 'invalid_templates'; end if;
      if v_section ? 'cards' and (v_section ->> 'cards') not in ('elevated', 'flat', 'outlined') then return 'invalid_templates'; end if;
      if v_section ? 'density' and (v_section ->> 'density') not in ('compact', 'comfortable', 'spacious') then return 'invalid_templates'; end if;
    end if;
    v_section := p_config -> 'seo';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['titleSuffix', 'description']) is not null then return 'invalid_seo'; end if;
      if v_section ? 'titleSuffix' and not public.cfg_text_ok(v_section -> 'titleSuffix', 40) then return 'invalid_seo'; end if;
      if v_section ? 'description' and not public.cfg_text_ok(v_section -> 'description', 160) then return 'invalid_seo'; end if;
    end if;
    v_section := p_config -> 'pwa';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['installTitle', 'installText', 'appName', 'shortName', 'iconUrl', 'themeColor', 'backgroundColor']) is not null then return 'invalid_pwa'; end if;
      if v_section ? 'appName' and not (public.cfg_text_ok(v_section -> 'appName', 30) and length(trim(v_section ->> 'appName')) >= 2) then return 'invalid_pwa_name'; end if;
      if v_section ? 'shortName' and not (public.cfg_text_ok(v_section -> 'shortName', 12) and length(trim(v_section ->> 'shortName')) >= 2) then return 'invalid_pwa_name'; end if;
      if v_section ? 'iconUrl' and not public.cfg_media_ok(v_section -> 'iconUrl') then return 'invalid_pwa_icon'; end if;
      if v_section ? 'iconUrl' and (v_section ->> 'iconUrl') !~* '\.png$' then return 'invalid_pwa_icon'; end if;
      if v_section ? 'themeColor' and not (jsonb_typeof(v_section -> 'themeColor') = 'string' and (v_section ->> 'themeColor') ~ '^#[0-9a-fA-F]{6}$') then return 'invalid_pwa_colour'; end if;
      if v_section ? 'backgroundColor' and not (jsonb_typeof(v_section -> 'backgroundColor') = 'string' and (v_section ->> 'backgroundColor') ~ '^#[0-9a-fA-F]{6}$') then return 'invalid_pwa_colour'; end if;
      if v_section ? 'installTitle' and not public.cfg_text_ok(v_section -> 'installTitle', 60) then return 'invalid_pwa'; end if;
      if v_section ? 'installText' and not public.cfg_text_ok(v_section -> 'installText', 160) then return 'invalid_pwa'; end if;
    end if;
    v_section := p_config -> 'translations';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' then return 'invalid_translations'; end if;
      if (select count(*) from jsonb_object_keys(v_section)) > 400 then return 'too_many_translations'; end if;
      for v_key, v_value in select * from jsonb_each(v_section) loop
        if v_key !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)+$' or jsonb_typeof(v_value) <> 'object' or public.cfg_unknown_key(v_value, array['en', 'dv']) is not null then return 'invalid_translation_key'; end if;
        if (v_value ? 'en' and not public.cfg_text_ok(v_value -> 'en', 200)) or (v_value ? 'dv' and not public.cfg_text_ok(v_value -> 'dv', 200)) then return 'invalid_translation_text'; end if;
      end loop;
    end if;
    return null;
  elsif p_kind = 'platform' then
    v_key := public.cfg_unknown_key(p_config, array['maintenance', 'features', 'help', 'sports', 'places', 'uploads', 'legal']);
    if v_key is not null then return 'unknown_key:' || v_key; end if;
    v_section := p_config -> 'maintenance';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['enabled', 'message', 'messageDv', 'endsAt']) is not null then return 'invalid_maintenance'; end if;
      if v_section ? 'enabled' and jsonb_typeof(v_section -> 'enabled') <> 'boolean' then return 'invalid_maintenance'; end if;
      if v_section ? 'message' and not public.cfg_text_ok(v_section -> 'message', 200) then return 'invalid_maintenance'; end if;
      if v_section ? 'messageDv' and not public.cfg_text_ok(v_section -> 'messageDv', 200) then return 'invalid_maintenance'; end if;
      if v_section ? 'endsAt' and not (jsonb_typeof(v_section -> 'endsAt') = 'string' and (v_section ->> 'endsAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}') then return 'invalid_maintenance'; end if;
      if coalesce((v_section ->> 'enabled')::boolean, false) and length(trim(coalesce(v_section ->> 'message', ''))) < 5 then return 'maintenance_message_required'; end if;
    end if;
    v_section := p_config -> 'features';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['recentlyViewed', 'news', 'installPrompt', 'calendarExports', 'topPlayers']) is not null then return 'invalid_features'; end if;
      if exists (select 1 from jsonb_each(v_section) e where jsonb_typeof(e.value) <> 'boolean') then return 'invalid_features'; end if;
    end if;
    v_section := p_config -> 'help';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['email', 'phone', 'hours']) is not null then return 'invalid_help'; end if;
      if v_section ? 'email' and not (jsonb_typeof(v_section -> 'email') = 'string' and (v_section ->> 'email') ~ '^[^@\s<>]{1,64}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,}$') then return 'invalid_email'; end if;
      if v_section ? 'phone' and not (jsonb_typeof(v_section -> 'phone') = 'string' and (v_section ->> 'phone') ~ '^[0-9 +()-]{3,20}$') then return 'invalid_phone'; end if;
      if v_section ? 'hours' and not public.cfg_text_ok(v_section -> 'hours', 80) then return 'invalid_help'; end if;
    end if;
    v_section := p_config -> 'sports';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['hidden']) is not null then return 'invalid_sports'; end if;
      -- At least one sport stays visible.
      if v_section ? 'hidden' and not (public.cfg_id_list_ok(v_section -> 'hidden', v_sports, 5)) then return 'invalid_sports'; end if;
    end if;
    -- Places: suggestion lists for island, atoll and venue fields. Free text stays allowed.
    v_section := p_config -> 'places';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['atolls', 'islands', 'venues']) is not null then return 'invalid_places'; end if;
      if v_section ? 'atolls' then
        if jsonb_typeof(v_section -> 'atolls') <> 'array' or jsonb_array_length(v_section -> 'atolls') > 30 then return 'invalid_places'; end if;
        for v_item in select * from jsonb_array_elements(v_section -> 'atolls') loop
          if not (public.cfg_text_ok(v_item, 40) and length(trim(v_item #>> '{}')) >= 2) then return 'invalid_place_name'; end if;
        end loop;
      end if;
      if v_section ? 'islands' then
        if jsonb_typeof(v_section -> 'islands') <> 'array' or jsonb_array_length(v_section -> 'islands') > 300 then return 'invalid_places'; end if;
        for v_item in select * from jsonb_array_elements(v_section -> 'islands') loop
          if jsonb_typeof(v_item) <> 'object' or public.cfg_unknown_key(v_item, array['name', 'atoll']) is not null then return 'invalid_places'; end if;
          if not (public.cfg_text_ok(v_item -> 'name', 80) and length(trim(v_item ->> 'name')) >= 2) then return 'invalid_place_name'; end if;
          if v_item ? 'atoll' and not public.cfg_text_ok(v_item -> 'atoll', 40) then return 'invalid_place_name'; end if;
        end loop;
      end if;
      if v_section ? 'venues' then
        if jsonb_typeof(v_section -> 'venues') <> 'array' or jsonb_array_length(v_section -> 'venues') > 200 then return 'invalid_places'; end if;
        for v_item in select * from jsonb_array_elements(v_section -> 'venues') loop
          if jsonb_typeof(v_item) <> 'object' or public.cfg_unknown_key(v_item, array['name', 'island']) is not null then return 'invalid_places'; end if;
          if not (public.cfg_text_ok(v_item -> 'name', 120) and length(trim(v_item ->> 'name')) >= 2) then return 'invalid_place_name'; end if;
          if v_item ? 'island' and not public.cfg_text_ok(v_item -> 'island', 80) then return 'invalid_place_name'; end if;
        end loop;
      end if;
    end if;
    -- Upload limits can only be lower than the storage limits (images 5 MB, documents 10 MB).
    v_section := p_config -> 'uploads';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['imageMb', 'documentMb']) is not null then return 'invalid_uploads'; end if;
      if v_section ? 'imageMb' and not (jsonb_typeof(v_section -> 'imageMb') = 'number' and (v_section ->> 'imageMb') ~ '^[0-9]+$' and (v_section ->> 'imageMb')::integer between 1 and 5) then return 'invalid_uploads'; end if;
      if v_section ? 'documentMb' and not (jsonb_typeof(v_section -> 'documentMb') = 'number' and (v_section ->> 'documentMb') ~ '^[0-9]+$' and (v_section ->> 'documentMb')::integer between 1 and 10) then return 'invalid_uploads'; end if;
    end if;
    -- Legal versions: a version label and effective date per legal page.
    v_section := p_config -> 'legal';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, v_legal) is not null then return 'invalid_legal'; end if;
      for v_key, v_item in select * from jsonb_each(v_section) loop
        if jsonb_typeof(v_item) <> 'object' or public.cfg_unknown_key(v_item, array['version', 'effective']) is not null then return 'invalid_legal'; end if;
        if not (jsonb_typeof(v_item -> 'version') = 'string' and (v_item ->> 'version') ~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,11}$') then return 'invalid_legal_version'; end if;
        if v_item ? 'effective' and not (jsonb_typeof(v_item -> 'effective') = 'string' and (v_item ->> 'effective') ~ '^\d{4}-\d{2}-\d{2}$') then return 'invalid_legal_date'; end if;
      end loop;
    end if;
    return null;
  end if;
  return 'invalid_kind';
end;
$$;
