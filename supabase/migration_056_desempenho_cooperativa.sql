-- ============================================================
-- BORA LÁ - migration_056: desempenho das regras de acesso (perfil Cooperativa)
-- A leitura das viagens pela cooperativa estourava o tempo limite do Supabase (erro 500
-- após ~8 s): cada viagem disparava várias consultas aninhadas (viagem → motorista →
-- veículo → cooperativa). Agora a lista de motoristas, veículos e viagens da cooperativa
-- é calculada UMA vez por consulta, e as funções de perfil viram constantes da consulta.
-- O que cada perfil enxerga não muda; a frota volta a ficar isolada por cooperativa.
-- Seguro rodar mais de uma vez.
-- ============================================================

-- 1. Conjuntos da cooperativa logada (regra igual à cooperativa_do_motorista:
--    vale a cooperativa escrita no veículo; sem ela, a cooperativa do motorista).
create or replace function public.motoristas_da_cooperativa_atual()
returns setof uuid language sql stable security definer set search_path = public as $$
  select d.id
  from public.drivers d
  left join public.vehicles v on v.id = d.vehicle_id
  join public.cooperativas c on c.id = public.current_cooperativa_id()
  where case when coalesce(trim(v.cooperative), '') <> ''
             then (v.cooperative = c.id::text or lower(trim(v.cooperative)) = lower(trim(c.name)))
             else d.cooperativa_id = c.id end;
$$;

create or replace function public.veiculos_da_cooperativa_atual()
returns setof uuid language sql stable security definer set search_path = public as $$
  select v.id
  from public.vehicles v
  join public.cooperativas c on c.id = public.current_cooperativa_id()
  where v.cooperative = c.id::text
     or lower(trim(coalesce(v.cooperative, ''))) = lower(trim(c.name))
     or (coalesce(trim(v.cooperative), '') = '' and exists (
           select 1 from public.drivers d where d.vehicle_id = v.id and d.cooperativa_id = c.id));
$$;

create or replace function public.viagens_da_cooperativa_atual()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct ed.excursion_id
  from public.excursion_drivers ed
  where ed.driver_id in (select public.motoristas_da_cooperativa_atual());
$$;

grant execute on function public.motoristas_da_cooperativa_atual() to authenticated;
grant execute on function public.veiculos_da_cooperativa_atual() to authenticated;
grant execute on function public.viagens_da_cooperativa_atual() to authenticated;

-- 2. Viagens.
drop policy if exists "excursions_select" on public.excursions;
create policy "excursions_select" on public.excursions for select using (
  (select public.current_role_name()) in ('admin','pedagogia')
  or ((select public.current_role_name()) = 'escola' and school_id = (select public.current_school_id()))
  or ((select public.current_role_name()) = 'motorista' and (
    exists (select 1 from public.excursion_drivers ed where ed.excursion_id = excursions.id and ed.driver_id = (select public.current_driver_id()))
    or (excursions.status in ('approved','in_transit','completed') and coalesce(excursions.situacao, '') not in ('cancelada','reprovada')
        and exists (select 1 from public.excursion_drivers ed where ed.excursion_id = excursions.id))
  ))
);
drop policy if exists "excursions_agente_coop_select" on public.excursions;
create policy "excursions_agente_coop_select" on public.excursions for select using (
  (select public.current_role_name()) = 'agente_externo' and id in (select public.viagens_da_cooperativa_atual())
);
drop policy if exists "excursions_operacional_select" on public.excursions;
create policy "excursions_operacional_select" on public.excursions for select using (
  (select public.current_role_name()) = 'operacional' and (
    (select public.has_access_permission('dashboard')) or (select public.has_access_permission('agenda'))
    or (select public.has_access_permission('relatorios')) or (select public.has_access_permission('validacoes')))
);
drop policy if exists "excursions_operacional_pendencias_select" on public.excursions;
create policy "excursions_operacional_pendencias_select" on public.excursions for select using (
  (select public.current_role_name()) = 'operacional' and (select public.has_access_permission('pendencias'))
);

-- 3. Motorista x viagem.
drop policy if exists "excursion_drivers_agente_coop_select" on public.excursion_drivers;
drop policy if exists "excursion_drivers_select_by_role" on public.excursion_drivers;
create policy "excursion_drivers_select_by_role" on public.excursion_drivers for select using (
  (select public.current_role_name()) <> 'agente_externo'
  or driver_id in (select public.motoristas_da_cooperativa_atual())
);

-- 4. Motoristas e veículos (frota isolada por cooperativa).
drop policy if exists "drivers_select_by_role" on public.drivers;
create policy "drivers_select_by_role" on public.drivers for select using (
  (select public.current_role_name()) <> 'agente_externo'
  or id in (select public.motoristas_da_cooperativa_atual())
);
drop policy if exists "vehicles_select_all" on public.vehicles;
drop policy if exists "vehicles_select_by_role" on public.vehicles;
create policy "vehicles_select_by_role" on public.vehicles for select using (
  auth.role() = 'authenticated'
  and ((select public.current_role_name()) <> 'agente_externo'
       or id in (select public.veiculos_da_cooperativa_atual()))
);

-- 5. Passageiros, lista PCD e arquivos de listagem da cooperativa.
drop policy if exists "passengers_agente_coop_select" on public.excursion_passengers;
create policy "passengers_agente_coop_select" on public.excursion_passengers for select using (
  (select public.current_role_name()) = 'agente_externo'
  and excursion_id in (select public.viagens_da_cooperativa_atual())
  and (driver_id is null or driver_id in (select public.motoristas_da_cooperativa_atual()))
);
drop policy if exists "pcd_students_agente_coop_select" on public.excursion_pcd_students;
create policy "pcd_students_agente_coop_select" on public.excursion_pcd_students for select using (
  (select public.current_role_name()) = 'agente_externo'
  and excursion_id in (select public.viagens_da_cooperativa_atual())
  and (select exists (select 1 from public.cooperativas c where c.id = public.current_cooperativa_id() and c.opera_pcd))
  and exists (select 1 from public.excursions e where e.id = excursion_pcd_students.excursion_id
              and (e.pcd_coop_id is null or e.pcd_coop_id = (select public.current_cooperativa_id())))
);
drop policy if exists "listagem_files_agente_coop_select" on public.excursion_listagem_files;
create policy "listagem_files_agente_coop_select" on public.excursion_listagem_files for select using (
  (select public.current_role_name()) = 'agente_externo'
  and excursion_id in (select public.viagens_da_cooperativa_atual())
  and (driver_id is null or driver_id in (select public.motoristas_da_cooperativa_atual()))
);

-- Índices de apoio (se ainda não existirem).
create index if not exists excursion_drivers_driver_idx on public.excursion_drivers(driver_id);
create index if not exists excursion_drivers_excursion_idx on public.excursion_drivers(excursion_id);

notify pgrst, 'reload schema';
