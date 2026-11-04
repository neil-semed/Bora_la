-- ============================================================
-- BORA LÁ - migration_052: isolamento entre cooperativas (perfil agente_externo)
-- Uma cooperativa não pode ler dados de outra:
--   1. Passageiros: só os dos veículos da própria cooperativa (antes via regra da
--      migration_023, que liberava a viagem inteira quando ela tinha 1 veículo da cooperativa).
--   2. Lista PCD: só quando a cooperativa opera PCD e o pedido foi enviado a ela
--      (antes, qualquer cooperativa com veículo na viagem via a lista).
--   3. Veículos: só a frota da própria cooperativa (antes, todos os veículos).
-- As regras corretas da migration_044 (por veículo) continuam valendo. Seguro rodar mais de uma vez.
-- ============================================================

-- 1. Passageiros: a regra antiga deixa de valer para o agente externo.
drop policy if exists "passengers_select_by_role" on public.excursion_passengers;
create policy "passengers_select_by_role" on public.excursion_passengers for select using (
  exists (select 1 from public.excursions e where e.id = excursion_passengers.excursion_id and (
    public.current_role_name() in ('admin','pedagogia')
    or (public.current_role_name() = 'escola' and e.school_id = public.current_school_id())
    or (public.current_role_name() = 'motorista' and exists (select 1 from public.excursion_drivers ed where ed.excursion_id = e.id and ed.driver_id = public.current_driver_id()))
  ))
);

-- 2. Lista PCD: idem.
drop policy if exists "pcd_students_select_by_role" on public.excursion_pcd_students;
create policy "pcd_students_select_by_role" on public.excursion_pcd_students for select using (
  exists (select 1 from public.excursions e where e.id = excursion_pcd_students.excursion_id and (
    public.current_role_name() in ('admin','pedagogia')
    or (public.current_role_name() = 'escola' and e.school_id = public.current_school_id())
    or (public.current_role_name() = 'motorista' and exists (select 1 from public.excursion_drivers ed where ed.excursion_id = e.id and ed.driver_id = public.current_driver_id()))
  ))
);

-- 3. Veículos: o agente externo vê só a frota da própria cooperativa.
-- Função security definer evita recursão entre as regras de veículos e motoristas.
create or replace function public.veiculo_da_cooperativa_atual(p_vehicle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_cooperativa_id() is not null and exists (
    select 1 from public.vehicles v
    left join public.cooperativas c on c.id = public.current_cooperativa_id()
    where v.id = p_vehicle and (
      v.cooperative = public.current_cooperativa_id()::text
      or (c.name is not null and lower(trim(coalesce(v.cooperative, ''))) = lower(trim(c.name)))
      or (coalesce(trim(v.cooperative), '') = '' and exists (
            select 1 from public.drivers d where d.vehicle_id = v.id and d.cooperativa_id = public.current_cooperativa_id()))
    )
  );
$$;
grant execute on function public.veiculo_da_cooperativa_atual(uuid) to authenticated;

drop policy if exists "vehicles_select_all" on public.vehicles;
drop policy if exists "vehicles_select_by_role" on public.vehicles;
create policy "vehicles_select_by_role" on public.vehicles for select using (
  auth.role() = 'authenticated'
  and (coalesce(public.current_role_name(), '') <> 'agente_externo' or public.veiculo_da_cooperativa_atual(id))
);

notify pgrst, 'reload schema';

-- Conferir: select tablename, policyname, cmd from pg_policies
--   where tablename in ('excursion_passengers','excursion_pcd_students','vehicles') order by 1, 2;
