-- Bora Lá | Aporte financeiro vinculado à excursão/recorrência.
-- Execute uma vez no SQL Editor do Supabase, após as migrations anteriores.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','escola','pedagogia','motorista','operacional','agente_externo','financeiro'));

create table if not exists public.finance_requests (
  id uuid primary key default gen_random_uuid(),
  root_excursion_id uuid references public.excursions(id) on delete cascade,
  recurrence_group_id uuid,
  school_id uuid references public.schools(id) on delete set null,
  requested_by uuid references public.profiles(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  requested_total numeric(12,2) not null default 0,
  document_filename text,
  document_drive_url text,
  document_uploaded_at timestamptz,
  status text not null default 'solicitado'
    check (status in ('solicitado','em_analise','deferido','deferido_parcial','indeferido')),
  approved_total numeric(12,2),
  decision_comment text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.excursions add column if not exists finance_request_id uuid references public.finance_requests(id) on delete set null;
create index if not exists finance_requests_recurrence_group_idx on public.finance_requests(recurrence_group_id);
create index if not exists excursions_finance_request_idx on public.excursions(finance_request_id);

alter table public.finance_requests enable row level security;
drop policy if exists finance_requests_select_by_role on public.finance_requests;
create policy finance_requests_select_by_role on public.finance_requests for select using (
  public.current_role_name() in ('admin','pedagogia','financeiro')
  or school_id = public.current_school_id()
);
drop policy if exists finance_requests_insert_school_or_admin on public.finance_requests;
create policy finance_requests_insert_school_or_admin on public.finance_requests for insert with check (
  public.current_role_name() = 'admin'
  or (public.current_role_name() = 'escola' and school_id = public.current_school_id())
);
drop policy if exists finance_requests_update_finance_or_admin on public.finance_requests;
create policy finance_requests_update_finance_or_admin on public.finance_requests for update using (
  public.current_role_name() in ('admin','financeiro')
) with check (public.current_role_name() in ('admin','financeiro'));

-- O Financeiro decide somente o aporte. Nenhuma atualização nesta tabela altera
-- status, situação, motorista, ATF ou a aprovação da excursão.
