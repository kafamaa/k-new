-- Stage 7 operations. Additive and review-only; never apply to production from this workspace.
create table if not exists public.tournament_staff_assignments (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  permission text not null check (permission in ('registration','finance','media','operations','match_data')),
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id, permission)
);
create or replace function public.has_tournament_permission(p_tournament_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_tournament_operator(p_tournament_id) or exists (select 1 from public.tournament_staff_assignments a where a.tournament_id = p_tournament_id and a.user_id = auth.uid() and a.permission = p_permission);
$$;
revoke execute on function public.has_tournament_permission(uuid, text) from public, anon;
grant execute on function public.has_tournament_permission(uuid, text) to authenticated, service_role;

create table if not exists public.finance_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  tournament_id uuid references public.tournaments(id) on delete restrict,
  category text not null,
  description text not null,
  amount_mvr numeric(12,2) not null check (amount_mvr > 0),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','refunded')),
  proof_document_id uuid references public.private_documents(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table if not exists public.finance_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  tournament_id uuid references public.tournaments(id) on delete restrict,
  payment_id uuid references public.tournament_payments(id) on delete restrict,
  expense_id uuid references public.finance_expenses(id) on delete restrict,
  receipt_number text not null unique,
  amount_mvr numeric(12,2) not null check (amount_mvr >= 0),
  receipt_path text,
  issued_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (payment_id is not null or expense_id is not null)
);
create table if not exists public.finance_adjustments (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.tournament_payments(id) on delete cascade,
  kind text not null check (kind in ('waiver','refund')),
  amount_mvr numeric(12,2) not null check (amount_mvr > 0),
  reason text not null,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  tournament_id uuid references public.tournaments(id) on delete set null,
  notification_type text not null,
  title text not null,
  body text not null,
  channel text not null check (channel in ('in_app','email')),
  state text not null default 'queued' check (state in ('queued','read','sent','failed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel text not null check (channel in ('in_app','email')),
  state text not null default 'queued' check (state in ('queued','sent','failed')),
  attempts integer not null default 0,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.tournament_staff_assignments enable row level security;
alter table public.finance_expenses enable row level security;
alter table public.finance_receipts enable row level security;
alter table public.finance_adjustments enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;

create policy "operators manage tournament staff" on public.tournament_staff_assignments for all using (public.is_tournament_operator(tournament_id)) with check (assigned_by = auth.uid() and public.is_tournament_operator(tournament_id));
create policy "finance staff manage expenses" on public.finance_expenses for all using (public.has_tournament_permission(tournament_id, 'finance') or (tournament_id is null and exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance')))) with check (created_by = auth.uid() and (public.has_tournament_permission(tournament_id, 'finance') or (tournament_id is null and exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance')))));
create policy "finance staff manage receipts" on public.finance_receipts for all using (public.has_tournament_permission(tournament_id, 'finance') or exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance'))) with check (issued_by = auth.uid() and (public.has_tournament_permission(tournament_id, 'finance') or exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance'))));
create policy "finance staff manage adjustments" on public.finance_adjustments for all using (exists (select 1 from public.tournament_payments p join public.tournament_entries e on e.id = p.entry_id where p.id = payment_id and public.has_tournament_permission(e.tournament_id, 'finance'))) with check (approved_by = auth.uid());
create policy "recipients read notifications" on public.notifications for select using (recipient_id = auth.uid());
create policy "recipients update notifications" on public.notifications for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy "authorized staff create notifications" on public.notifications for insert with check (created_by = auth.uid() and (tournament_id is null or public.has_tournament_permission(tournament_id, 'operations')));
create policy "recipients read delivery state" on public.notification_deliveries for select using (exists (select 1 from public.notifications n where n.id = notification_id and n.recipient_id = auth.uid()));
create policy "trusted delivery updates" on public.notification_deliveries for update using (false) with check (false);

-- Team managers may submit manual proof through the existing private-document flow;
-- finance staff alone changes payment verification, waivers, and refunds.
create policy "team managers submit payment proof" on public.tournament_payments for insert with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id)) and created_by = auth.uid());
create policy "finance staff update payment state" on public.tournament_payments for update using (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.has_tournament_permission(e.tournament_id, 'finance'))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.has_tournament_permission(e.tournament_id, 'finance')));

create policy "finance staff append audit" on public.audit_events for insert with check (actor_id = auth.uid() and entity_type in ('finance_expense','finance_receipt','finance_adjustment','tournament_payment'));
create or replace function public.audit_finance_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), tg_op || '_finance_record', tg_table_name, new.id, 'Finance record change');
  return new;
end;
$$;
drop trigger if exists audit_finance_expenses on public.finance_expenses;
create trigger audit_finance_expenses after insert or update on public.finance_expenses for each row execute function public.audit_finance_change();
drop trigger if exists audit_finance_receipts on public.finance_receipts;
create trigger audit_finance_receipts after insert or update on public.finance_receipts for each row execute function public.audit_finance_change();
drop trigger if exists audit_finance_adjustments on public.finance_adjustments;
create trigger audit_finance_adjustments after insert or update on public.finance_adjustments for each row execute function public.audit_finance_change();
