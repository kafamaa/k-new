-- Stage 3 registration slice. Additive and review-only; do not apply to production without authorization.
create or replace function public.is_tournament_operator(p_tournament_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournaments t
    join public.organization_memberships om on om.organization_id = t.organization_id
    where t.id = p_tournament_id and om.user_id = auth.uid() and om.role in ('owner','operations')
  );
$$;
create or replace function public.is_team_manager(p_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_memberships where team_id = p_team_id and user_id = auth.uid());
$$;
revoke execute on function public.is_tournament_operator(uuid) from public, anon;
revoke execute on function public.is_team_manager(uuid) from public, anon;
grant execute on function public.is_tournament_operator(uuid) to authenticated, service_role;
grant execute on function public.is_team_manager(uuid) to authenticated, service_role;

create table if not exists public.tournament_setup_steps (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  step_number smallint not null check (step_number between 1 and 11),
  status text not null default 'not_started' check (status in ('not_started','in_progress','complete','blocked')),
  data jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (tournament_id, step_number)
);

create table if not exists public.tournament_registration_settings (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  opens_at timestamptz,
  closes_at timestamptz,
  application_method text not null default 'team_application' check (application_method in ('team_application','invite_only','both')),
  entry_requirements text,
  contact_instructions text,
  roster_min smallint check (roster_min is null or roster_min >= 0),
  roster_max smallint check (roster_max is null or roster_max >= coalesce(roster_min, 0)),
  roster_deadline timestamptz,
  documents_required boolean not null default false,
  change_rules text,
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_registration_questions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  field_key text not null,
  prompt text not null,
  response_type text not null default 'text' check (response_type in ('text','long_text','number','boolean','select')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  sort_order smallint not null default 0,
  unique (tournament_id, field_key)
);

create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  application_status text not null default 'draft' check (application_status in ('draft','submitted','under_review','changes_requested','approved','rejected','withdrawn')),
  roster_status text not null default 'not_started' check (roster_status in ('not_started','draft','submitted','under_review','changes_requested','approved','locked','rejected')),
  payment_status text not null default 'not_required' check (payment_status in ('not_required','unpaid','proof_submitted','under_review','paid','waived','refunded','overdue')),
  submitted_by uuid references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, team_id)
);

create table if not exists public.tournament_registration_answers (
  entry_id uuid not null references public.tournament_entries(id) on delete cascade,
  question_id uuid not null references public.tournament_registration_questions(id) on delete cascade,
  answer jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (entry_id, question_id)
);

create table if not exists public.roster_submissions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.tournament_entries(id) on delete cascade,
  version integer not null,
  status text not null default 'draft' check (status in ('draft','submitted','under_review','changes_requested','approved','locked','rejected')),
  submitted_by uuid references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  review_notes text,
  created_at timestamptz not null default now(),
  unique (entry_id, version)
);

create table if not exists public.roster_submission_players (
  submission_id uuid not null references public.roster_submissions(id) on delete cascade,
  player_id uuid not null references public.player_profiles(id) on delete restrict,
  shirt_number text,
  position text,
  primary key (submission_id, player_id)
);

create table if not exists public.tournament_fees (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  label text not null,
  amount_mvr numeric(12,2) not null check (amount_mvr >= 0),
  due_at timestamptz,
  required boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict
);
create table if not exists public.tournament_payments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.tournament_entries(id) on delete cascade,
  fee_id uuid not null references public.tournament_fees(id) on delete restrict,
  amount_mvr numeric(12,2) not null check (amount_mvr >= 0),
  status text not null default 'proof_submitted' check (status in ('proof_submitted','under_review','paid','waived','refunded','rejected')),
  proof_document_id uuid,
  verified_by uuid references public.profiles(id) on delete restrict,
  verified_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.private_documents (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  entry_id uuid references public.tournament_entries(id) on delete restrict,
  player_id uuid references public.player_profiles(id) on delete restrict,
  document_type text not null,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  retention_until timestamptz,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (entry_id is not null or player_id is not null)
);

alter table public.tournament_setup_steps enable row level security;
alter table public.tournament_registration_settings enable row level security;
alter table public.tournament_registration_questions enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_registration_answers enable row level security;
alter table public.roster_submissions enable row level security;
alter table public.roster_submission_players enable row level security;
alter table public.tournament_fees enable row level security;
alter table public.tournament_payments enable row level security;
alter table public.private_documents enable row level security;

create policy "operators manage setup steps" on public.tournament_setup_steps for all using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
create policy "operators manage registration settings" on public.tournament_registration_settings for all using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
create policy "published registration questions are public" on public.tournament_registration_questions for select using (exists (select 1 from public.tournaments t where t.id = tournament_id and t.is_published));
create policy "operators manage registration questions" on public.tournament_registration_questions for all using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));

create policy "operators read entries" on public.tournament_entries for select using (public.is_tournament_operator(tournament_id));
create policy "team managers read own entries" on public.tournament_entries for select using (public.is_team_manager(team_id));
create policy "team managers submit applications" on public.tournament_entries for insert with check (
  public.is_team_manager(team_id) and exists (
    select 1 from public.tournaments t left join public.tournament_registration_settings rs on rs.tournament_id = t.id
    where t.id = tournament_id and t.status = 'registration_open' and coalesce(rs.application_method, 'team_application') in ('team_application','both')
  )
);
create policy "operators add tournament entries" on public.tournament_entries for insert with check (public.is_tournament_operator(tournament_id));
create policy "team managers update own applications" on public.tournament_entries for update using (public.is_team_manager(team_id)) with check (public.is_team_manager(team_id));
create policy "operators review entries" on public.tournament_entries for update using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));

create or replace function public.protect_entry_statuses()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_tournament_operator(old.tournament_id) and new.application_status is distinct from old.application_status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  if not public.is_tournament_operator(old.tournament_id) then
    if new.tournament_id <> old.tournament_id or new.team_id <> old.team_id then raise exception 'team_manager_cannot_move_entry_scope'; end if;
    if new.roster_status <> old.roster_status or new.payment_status <> old.payment_status or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at or new.review_notes is distinct from old.review_notes then
      raise exception 'team_manager_cannot_change_roster_payment_or_review_status';
    end if;
    if new.application_status not in ('draft','submitted','changes_requested') then raise exception 'team_manager_cannot_approve_application'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_entry_statuses_trigger on public.tournament_entries;
create trigger protect_entry_statuses_trigger before update on public.tournament_entries for each row execute function public.protect_entry_statuses();

create policy "entry participants read answers" on public.tournament_registration_answers for select using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
create policy "entry participants write answers" on public.tournament_registration_answers for all using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id)))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));

create policy "participants read rosters" on public.roster_submissions for select using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
create policy "participants write rosters" on public.roster_submissions for all using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id)))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
create policy "participants read roster players" on public.roster_submission_players for select using (exists (select 1 from public.roster_submissions r where r.id = submission_id));
create policy "participants write roster players" on public.roster_submission_players for all using (exists (select 1 from public.roster_submissions r where r.id = submission_id)) with check (exists (select 1 from public.roster_submissions r where r.id = submission_id));

create policy "operators manage fees" on public.tournament_fees for all using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
create policy "operators manage payments" on public.tournament_payments for all using (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_tournament_operator(e.tournament_id))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_tournament_operator(e.tournament_id)));
create policy "team managers read payments" on public.tournament_payments for select using (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id)));
create policy "private documents are scoped" on public.private_documents for all using (public.is_tournament_operator(tournament_id) or exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id))) with check (uploaded_by = auth.uid() and (public.is_tournament_operator(tournament_id) or exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id))));

insert into storage.buckets (id, name, public) values ('tournament-private-documents', 'tournament-private-documents', false) on conflict (id) do nothing;
create policy "authorized users upload tournament documents" on storage.objects for insert with check (
  bucket_id = 'tournament-private-documents' and (
    public.is_tournament_operator((storage.foldername(name))[1]::uuid)
    or exists (select 1 from public.tournament_entries e where e.id = (storage.foldername(name))[2]::uuid and public.is_team_manager(e.team_id))
  )
);
create policy "authorized users read tournament documents" on storage.objects for select using (
  bucket_id = 'tournament-private-documents' and (
    public.is_tournament_operator((storage.foldername(name))[1]::uuid)
    or exists (select 1 from public.tournament_entries e where e.id = (storage.foldername(name))[2]::uuid and public.is_team_manager(e.team_id))
  )
);

create or replace function public.submit_roster(p_entry_id uuid, p_player_ids uuid[], p_actor_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  entry public.tournament_entries;
  next_version integer;
  roster_id uuid;
  player_id uuid;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select * into entry from public.tournament_entries where id = p_entry_id for update;
  if entry.id is null or not (public.is_tournament_operator(entry.tournament_id) or public.is_team_manager(entry.team_id)) or entry.roster_status = 'locked' then
    raise exception 'roster_not_authorized_or_locked';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.roster_submissions where entry_id = p_entry_id;
  insert into public.roster_submissions(entry_id, version, status, submitted_by) values (p_entry_id, next_version, 'submitted', p_actor_id) returning id into roster_id;
  foreach player_id in array p_player_ids loop
    insert into public.roster_submission_players(submission_id, player_id) values (roster_id, player_id);
  end loop;
  update public.tournament_entries set roster_status = 'submitted', updated_at = now() where id = p_entry_id;
  return roster_id;
end;
$$;
revoke execute on function public.submit_roster(uuid, uuid[], uuid) from public, anon;
grant execute on function public.submit_roster(uuid, uuid[], uuid) to authenticated, service_role;
