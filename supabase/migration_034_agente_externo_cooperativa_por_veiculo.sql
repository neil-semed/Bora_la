-- Bora Lá | Agente Externo (cooperativa) sem pendências/listagens.
-- Causa: desde a migration_029 a cooperativa do motorista é definida pelo VEÍCULO
-- (vehicles.cooperative), mas as políticas de leitura de viagens, motoristas da viagem,
-- passageiros, lista PCD e arquivos de listagem ainda exigiam drivers.cooperativa_id.
-- Motoristas vinculados só pelo veículo deixavam a cooperativa sem nenhuma viagem.
-- Esta migration apenas ACRESCENTA políticas de leitura para o perfil agente_externo
-- (as políticas existentes dos demais perfis não são alteradas).
-- Execute uma vez no SQL Editor.

create or replace function public.motorista_da_cooperativa_atual(p_driver uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.drivers d
    left join public.vehicles v on v.id = d.vehicle_id
    join public.cooperativas c on c.id = public.current_cooperativa_id()
    where d.id = p_driver
      and (d.cooperativa_id = c.id or v.cooperative = c.id::text or lower(coalesce(v.cooperative, '')) = lower(c.name))
  );
$$;

create or replace function public.viagem_da_cooperativa_atual(p_excursion uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.excursion_drivers ed
    where ed.excursion_id = p_excursion and public.motorista_da_cooperativa_atual(ed.driver_id)
  );
$$;

drop policy if exists "excursions_agente_coop_select" on public.excursions;
create policy "excursions_agente_coop_select" on public.excursions for select using (
  public.current_role_name() = 'agente_externo' and public.viagem_da_cooperativa_atual(id)
);

drop policy if exists "excursion_drivers_agente_coop_select" on public.excursion_drivers;
create policy "excursion_drivers_agente_coop_select" on public.excursion_drivers for select using (
  public.current_role_name() = 'agente_externo' and public.motorista_da_cooperativa_atual(driver_id)
);

drop policy if exists "passengers_agente_coop_select" on public.excursion_passengers;
create policy "passengers_agente_coop_select" on public.excursion_passengers for select using (
  public.current_role_name() = 'agente_externo' and public.viagem_da_cooperativa_atual(excursion_id)
);

drop policy if exists "pcd_students_agente_coop_select" on public.excursion_pcd_students;
create policy "pcd_students_agente_coop_select" on public.excursion_pcd_students for select using (
  public.current_role_name() = 'agente_externo' and public.viagem_da_cooperativa_atual(excursion_id)
);

drop policy if exists "listagem_files_agente_coop_select" on public.excursion_listagem_files;
create policy "listagem_files_agente_coop_select" on public.excursion_listagem_files for select using (
  public.current_role_name() = 'agente_externo' and public.viagem_da_cooperativa_atual(excursion_id)
);
