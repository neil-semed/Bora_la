-- ============================================================
-- BORA LÁ - EXCURSÕES | Migração 002: Agenda avançada
-- Rode este arquivo no SQL Editor do Supabase DEPOIS do schema.sql
-- original. Ele só ADICIONA coisas (colunas, tabela nova, políticas
-- novas) — não apaga nada do que você já tem cadastrado.
-- ============================================================

-- ------------------------------------------------------------
-- 1) SCHOOLS -> passa a poder representar "Unidades" também
--    (escolas que pedem direto pelo site OU entidades que pedem
--    por e-mail e o admin cadastra a solicitação em nome delas)
-- ------------------------------------------------------------
alter table schools add column if not exists tipo text not null default 'escola'
  check (tipo in ('escola','entidade'));

-- ------------------------------------------------------------
-- 2) DRIVERS -> cada motorista passa a ser dono de um veículo
--    (dirige sempre o mesmo veículo, não escolhe outro na hora)
-- ------------------------------------------------------------
alter table drivers add column if not exists vehicle_id uuid references vehicles(id) on delete set null;

-- ------------------------------------------------------------
-- 3) EXCURSIONS -> campos novos pedidos:
--    turno, endereço do destino, passageiros PCA/apoios,
--    ATF, Situação (substitui o status como campo principal
--    visível pro admin/pedagogia/escola), envio à cooperativa,
--    lista da escola recebida
-- ------------------------------------------------------------
alter table excursions add column if not exists turno text check (turno in ('manha','tarde','noite'));
alter table excursions add column if not exists destination_address text;
alter table excursions add column if not exists pca_count int default 0;
alter table excursions add column if not exists apoio_count int default 0;

alter table excursions add column if not exists atf_status text not null default 'nao_precisa'
  check (atf_status in ('nao_precisa','nao_emitida','emitida'));

alter table excursions add column if not exists situacao text not null default 'sem_validacao'
  check (situacao in ('sem_validacao','aguarda_atf','aprovada','confirmada','envio_coop','reprovada','cancelada','sem_listagem'));

alter table excursions add column if not exists envio_coop_data date;
alter table excursions add column if not exists lista_escola boolean not null default false;
alter table excursions add column if not exists requester_name text;

create index if not exists idx_excursions_situacao on excursions(situacao);
create index if not exists idx_excursions_turno on excursions(turno);

-- ------------------------------------------------------------
-- 4) MÚLTIPLOS MOTORISTAS POR VIAGEM
--    (antes: 1 viagem tinha no máximo 1 motorista/veículo, via
--    excursions.assigned_driver_id/assigned_vehicle_id — esses
--    dois campos continuam existindo mas não são mais usados pra
--    exibir a atribuição; agora uma viagem pode ter vários
--    motoristas, cada um com seu próprio veículo)
-- ------------------------------------------------------------
create table if not exists excursion_drivers (
  excursion_id uuid not null references excursions(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  primary key (excursion_id, driver_id)
);

alter table excursion_drivers enable row level security;

drop policy if exists "excursion_drivers_select" on excursion_drivers;
create policy "excursion_drivers_select" on excursion_drivers for select
  using (auth.role() = 'authenticated');

drop policy if exists "excursion_drivers_write_admin" on excursion_drivers;
create policy "excursion_drivers_write_admin" on excursion_drivers for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

-- ------------------------------------------------------------
-- 5) Atualiza as políticas de excursions: motorista agora enxerga
--    (e atualiza status de execução de) uma viagem se ele estiver
--    em excursion_drivers, não só no antigo assigned_driver_id.
-- ------------------------------------------------------------
drop policy if exists "excursions_select" on excursions;
create policy "excursions_select" on excursions for select
  using (
    public.current_role_name() in ('admin','pedagogia')
    or (public.current_role_name() = 'escola' and school_id = public.current_school_id())
    or (public.current_role_name() = 'motorista' and exists (
          select 1 from excursion_drivers ed
          where ed.excursion_id = excursions.id and ed.driver_id = public.current_driver_id()
        ))
  );

drop policy if exists "excursions_update" on excursions;
create policy "excursions_update" on excursions for update
  using (
    public.current_role_name() in ('admin','pedagogia')
    or (public.current_role_name() = 'motorista' and exists (
          select 1 from excursion_drivers ed
          where ed.excursion_id = excursions.id and ed.driver_id = public.current_driver_id()
        ))
  )
  with check (
    public.current_role_name() in ('admin','pedagogia')
    or (public.current_role_name() = 'motorista' and exists (
          select 1 from excursion_drivers ed
          where ed.excursion_id = excursions.id and ed.driver_id = public.current_driver_id()
        ))
  );

-- ------------------------------------------------------------
-- 6) PROFILES -> leitura liberada pra qualquer autenticado
--    (precisamos disso pra mostrar o "primeiro nome" de quem
--    validou/aprovou uma viagem pra outros perfis, ex: escola
--    vendo quem validou o pedido dela). Alterar/inserir continua
--    só admin (ou o próprio dono da linha) — isso não muda.
-- ------------------------------------------------------------
drop policy if exists "profiles_select_own_or_admin" on profiles;
create policy "profiles_select_authenticated" on profiles for select
  using (auth.role() = 'authenticated');

-- ============================================================
-- Fim da migração 002. Nada aqui apaga dados existentes.
-- ============================================================
