-- Stage 5 match operations. Review-only; do not apply without local/target validation.
create table if not exists public.offline_sync_operations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  operation_id uuid not null unique,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation_type text not null check (operation_type in ('event','score_submission','status_change')),
  payload jsonb not null,
  base_result_version integer,
  status text not null default 'queued' check (status in ('queued','synced','conflict','rejected')),
  conflict_reason text,
  resolved_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  synced_at timestamptz
);
create index if not exists offline_sync_operations_match_idx on public.offline_sync_operations(match_id, created_at);
alter table public.offline_sync_operations enable row level security;
create policy "assigned actors manage sync operations" on public.offline_sync_operations for all using (actor_id = auth.uid() and public.is_match_participant(match_id)) with check (actor_id = auth.uid() and public.is_match_participant(match_id));
create policy "operators resolve sync conflicts" on public.offline_sync_operations for update using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));
