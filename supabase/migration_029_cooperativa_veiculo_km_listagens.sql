-- Bora Lá | Cooperativa definida pelo veículo + substituição de listagem.
-- Execute uma única vez no SQL Editor do projeto Bora Lá.
-- Esta migration preserva motoristas antigos que ainda tenham cooperativa_id.

-- O Agente Externo pode consultar os motoristas vinculados aos veículos da
-- cooperativa. O valor antigo em vehicles.cooperative pode ser o UUID ou o nome.
drop policy if exists "drivers_select_by_role" on public.drivers;
create policy "drivers_select_by_role" on public.drivers for select using (
  public.current_role_name() <> 'agente_externo'
  or drivers.cooperativa_id = public.current_cooperativa_id()
  or exists (
    select 1
    from public.vehicles v
    join public.cooperativas c on c.id = public.current_cooperativa_id()
    where v.id = drivers.vehicle_id
      and (v.cooperative = c.id::text or lower(coalesce(v.cooperative, '')) = lower(c.name))
  )
);

-- A mesma regra é aplicada aos registros de KM consultados pela cooperativa.
drop policy if exists "km_logs_select" on public.driver_km_logs;
create policy "km_logs_select" on public.driver_km_logs for select using (
  public.current_role_name() = 'admin'
  or (public.current_role_name() = 'motorista' and driver_id = public.current_driver_id())
  or (
    public.current_role_name() = 'agente_externo'
    and exists (
      select 1
      from public.drivers d
      left join public.vehicles v on v.id = d.vehicle_id
      join public.cooperativas c on c.id = public.current_cooperativa_id()
      where d.id = driver_km_logs.driver_id
        and (
          d.cooperativa_id = public.current_cooperativa_id()
          or v.cooperative = c.id::text
          or lower(coalesce(v.cooperative, '')) = lower(c.name)
        )
    )
  )
);

-- A escola pode remover a referência anterior antes de registrar o reenvio.
-- O arquivo físico anterior continua no Drive para auditoria, mas deixa de ser
-- apresentado ou encaminhado como a versão vigente.
drop policy if exists "listagem_files_delete" on public.excursion_listagem_files;
create policy "listagem_files_delete" on public.excursion_listagem_files for delete using (
  exists (
    select 1 from public.excursions e
    where e.id = excursion_listagem_files.excursion_id
      and (public.current_role_name() = 'admin'
        or (public.current_role_name() = 'escola' and e.school_id = public.current_school_id()))
  )
);
