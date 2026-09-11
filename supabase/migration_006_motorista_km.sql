-- ============================================================
-- MIGRAÇÃO 006 - Registro de KM (odômetro) dos motoristas
-- ============================================================
-- O que esta migração adiciona:
--  - Tabela driver_km_logs: 1 linha por motorista por dia, com o odômetro do
--    início e do fim do dia. O km rodado é calculado automaticamente (coluna
--    gerada) - ninguém precisa fazer essa conta na mão.
--  - RLS: cada motorista só grava/edita os próprios registros; o admin
--    grava/edita e vê os de todo mundo (é o admin que corrige o que o
--    motorista errar - pedido explícito do gestor).
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. É seguro rodar mais de
-- uma vez (idempotente): "if not exists"/"drop policy if exists" em tudo.
-- ============================================================

create table if not exists driver_km_logs (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id) on delete cascade,
  log_date date not null,
  odometer_start numeric(10,1),
  odometer_start_at timestamptz,
  odometer_end numeric(10,1),
  odometer_end_at timestamptz,
  -- calculado sozinho: se faltar início ou fim, fica nulo (não quebra nada)
  km_rodado numeric(10,1) generated always as (
    case when odometer_end is not null and odometer_start is not null
      then odometer_end - odometer_start
      else null end
  ) stored,
  observacoes text,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint driver_km_logs_um_por_dia unique (driver_id, log_date),
  constraint driver_km_logs_fim_maior_que_inicio check (
    odometer_end is null or odometer_start is null or odometer_end >= odometer_start
  )
);
create index if not exists idx_driver_km_logs_driver on driver_km_logs(driver_id);
create index if not exists idx_driver_km_logs_date on driver_km_logs(log_date);

alter table driver_km_logs enable row level security;

-- SELECT: motorista vê só os próprios; admin vê todos
drop policy if exists "km_logs_select" on driver_km_logs;
create policy "km_logs_select" on driver_km_logs for select
  using (
    public.current_role_name() = 'admin'
    or (public.current_role_name() = 'motorista' and driver_id = public.current_driver_id())
  );

-- INSERT: motorista só pode inserir registro dele mesmo; admin insere de qualquer motorista
drop policy if exists "km_logs_insert" on driver_km_logs;
create policy "km_logs_insert" on driver_km_logs for insert
  with check (
    public.current_role_name() = 'admin'
    or (public.current_role_name() = 'motorista' and driver_id = public.current_driver_id())
  );

-- UPDATE: idem (motorista corrige o próprio dia; admin corrige qualquer um)
drop policy if exists "km_logs_update" on driver_km_logs;
create policy "km_logs_update" on driver_km_logs for update
  using (
    public.current_role_name() = 'admin'
    or (public.current_role_name() = 'motorista' and driver_id = public.current_driver_id())
  )
  with check (
    public.current_role_name() = 'admin'
    or (public.current_role_name() = 'motorista' and driver_id = public.current_driver_id())
  );

-- DELETE: só admin (ex: registro duplicado/errado)
drop policy if exists "km_logs_delete_admin" on driver_km_logs;
create policy "km_logs_delete_admin" on driver_km_logs for delete
  using (public.current_role_name() = 'admin');

-- Trigger simples pra manter updated_at em dia a cada UPDATE
create or replace function public.set_km_logs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_km_logs_updated_at on driver_km_logs;
create trigger trg_km_logs_updated_at
  before update on driver_km_logs
  for each row execute function public.set_km_logs_updated_at();
