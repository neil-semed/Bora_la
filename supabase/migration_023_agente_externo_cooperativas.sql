-- Bora Lá | Agente Externo por cooperativa
-- Execute este arquivo inteiro no SQL Editor do Supabase depois das migrations 021 e 022.

-- Um perfil externo está ligado a uma cooperativa; esta coluna também permite que as
-- políticas de segurança filtrem dados no próprio banco, e não apenas na interface.
alter table profiles add column if not exists cooperativa_id uuid references cooperativas(id) on delete set null;
alter table cooperativas add column if not exists opera_atf boolean not null default true;
alter table cooperativas add column if not exists opera_pcd boolean not null default false;

-- Auditoria da confirmação do transporte adaptado pela cooperativa.
alter table excursions add column if not exists atf_emitida_por uuid references profiles(id);
alter table excursions add column if not exists atf_emitida_em timestamptz;
alter table excursions add column if not exists pcd_cooperativa_confirmado_em timestamptz;
alter table excursions add column if not exists pcd_cooperativa_confirmado_por uuid references profiles(id);
alter table excursions add column if not exists pcd_cooperativa_veiculo text;
alter table excursions add column if not exists pcd_cooperativa_motorista text;

-- Acrescenta o novo papel sem depender do nome gerado automaticamente para a constraint.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%role%' loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;
alter table profiles add constraint profiles_role_check check (role in ('admin','escola','pedagogia','motorista','operacional','agente_externo'));

-- A aplicação adota um login de agente por cooperativa.
create unique index if not exists profiles_one_external_agent_per_coop
  on profiles(cooperativa_id) where role = 'agente_externo' and active = true;

create or replace function public.current_cooperativa_id()
returns uuid language sql security definer stable set search_path = public as $$
  select cooperativa_id from public.profiles where id = auth.uid();
$$;

-- O agente não precisa consultar a relação completa de usuários; ele vê apenas o
-- próprio perfil. Os demais papéis preservam o comportamento atual da aplicação.
drop policy if exists "profiles_select_authenticated" on profiles;
drop policy if exists "profiles_select_own_or_admin" on profiles;
create policy "profiles_select_by_role" on profiles for select using (
  public.current_role_name() <> 'agente_externo' or id = auth.uid()
);

-- Motoristas e cooperativas: para agentes externos, apenas os dados da própria coop.
drop policy if exists "drivers_select_all" on drivers;
create policy "drivers_select_by_role" on drivers for select using (
  public.current_role_name() <> 'agente_externo'
  or cooperativa_id = public.current_cooperativa_id()
);
drop policy if exists "cooperativas_select_all" on cooperativas;
create policy "cooperativas_select_by_role" on cooperativas for select using (
  public.current_role_name() <> 'agente_externo'
  or id = public.current_cooperativa_id()
);

-- Viagens e suas atribuições: o agente só lê viagens que tenham motorista daquela coop.
drop policy if exists "excursions_select" on excursions;
create policy "excursions_select" on excursions for select using (
  public.current_role_name() in ('admin','pedagogia')
  or (public.current_role_name() = 'escola' and school_id = public.current_school_id())
  or (public.current_role_name() = 'motorista' and (
    exists (select 1 from excursion_drivers ed where ed.excursion_id = excursions.id and ed.driver_id = public.current_driver_id())
    or (excursions.status in ('approved','in_transit','completed') and coalesce(excursions.situacao, '') not in ('cancelada','reprovada') and exists (select 1 from excursion_drivers ed where ed.excursion_id = excursions.id))
  ))
  or (public.current_role_name() = 'agente_externo' and exists (
    select 1 from excursion_drivers ed join drivers d on d.id = ed.driver_id
    where ed.excursion_id = excursions.id and d.cooperativa_id = public.current_cooperativa_id()
  ))
);

drop policy if exists "excursion_drivers_select" on excursion_drivers;
create policy "excursion_drivers_select_by_role" on excursion_drivers for select using (
  public.current_role_name() <> 'agente_externo'
  or exists (select 1 from drivers d where d.id = excursion_drivers.driver_id and d.cooperativa_id = public.current_cooperativa_id())
);

-- As listas encaminhadas por e-mail também podem ser consultadas/baixadas pelo agente,
-- mas somente quando a viagem contém motorista de sua cooperativa.
drop policy if exists "pcd_students_select" on excursion_pcd_students;
create policy "pcd_students_select_by_role" on excursion_pcd_students for select using (
  exists (select 1 from excursions e where e.id = excursion_pcd_students.excursion_id and (
    public.current_role_name() in ('admin','pedagogia')
    or (public.current_role_name() = 'escola' and e.school_id = public.current_school_id())
    or (public.current_role_name() = 'motorista' and exists (select 1 from excursion_drivers ed where ed.excursion_id=e.id and ed.driver_id=public.current_driver_id()))
    or (public.current_role_name() = 'agente_externo' and exists (select 1 from excursion_drivers ed join drivers d on d.id=ed.driver_id where ed.excursion_id=e.id and d.cooperativa_id=public.current_cooperativa_id()))
  ))
);
drop policy if exists "passengers_select" on excursion_passengers;
create policy "passengers_select_by_role" on excursion_passengers for select using (
  exists (select 1 from excursions e where e.id = excursion_passengers.excursion_id and (
    public.current_role_name() in ('admin','pedagogia')
    or (public.current_role_name() = 'escola' and e.school_id = public.current_school_id())
    or (public.current_role_name() = 'motorista' and exists (select 1 from excursion_drivers ed where ed.excursion_id=e.id and ed.driver_id=public.current_driver_id()))
    or (public.current_role_name() = 'agente_externo' and exists (select 1 from excursion_drivers ed join drivers d on d.id=ed.driver_id where ed.excursion_id=e.id and d.cooperativa_id=public.current_cooperativa_id()))
  ))
);

drop policy if exists "km_logs_select" on driver_km_logs;
create policy "km_logs_select" on driver_km_logs for select using (
  public.current_role_name() = 'admin'
  or (public.current_role_name() = 'motorista' and driver_id = public.current_driver_id())
  or (public.current_role_name() = 'agente_externo' and exists (select 1 from drivers d where d.id = driver_km_logs.driver_id and d.cooperativa_id = public.current_cooperativa_id()))
);

-- ATF: somente agente da cooperativa atribuída e habilitada. A função registra a
-- emissão e notifica Admin, Pedagogia e a unidade solicitante na própria aplicação.
create or replace function public.agent_accept_atf(p_excursion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode confirmar ATF.'; end if;
  select * into v from excursions where id = p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if not exists (select 1 from excursion_drivers ed join drivers d on d.id = ed.driver_id join cooperativas c on c.id = d.cooperativa_id where ed.excursion_id = v.id and d.cooperativa_id = public.current_cooperativa_id() and c.opera_atf) then
    raise exception 'Esta cooperativa não está vinculada ou não opera ATF para esta viagem.';
  end if;
  update excursions set atf_status='emitida', atf_emitida_por=auth.uid(), atf_emitida_em=now(), situacao=case when situacao='aguarda_atf' then 'aprovada' else situacao end where id=v.id;
  insert into notifications(user_id, excursion_id, title, message)
    select p.id, v.id, 'ATF emitida pela cooperativa', 'A cooperativa confirmou a emissão da ATF da viagem de ' || to_char(v.trip_date,'DD/MM/YYYY') || '.'
    from profiles p where p.active and (p.role in ('admin','pedagogia') or (p.role='escola' and p.school_id=v.school_id));
end; $$;

-- PCD: veículo e motorista são opcionais; a confirmação fica visível para a escola.
create or replace function public.agent_confirm_pcd(p_excursion_id uuid, p_vehicle text default null, p_driver text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode confirmar transporte PCD.'; end if;
  select * into v from excursions where id = p_excursion_id for update;
  if not found or coalesce(v.pca_count,0) = 0 then raise exception 'Esta viagem não possui aluno PCD para confirmar.'; end if;
  if not exists (select 1 from excursion_drivers ed join drivers d on d.id = ed.driver_id join cooperativas c on c.id = d.cooperativa_id where ed.excursion_id=v.id and d.cooperativa_id=public.current_cooperativa_id() and c.opera_pcd) then
    raise exception 'Esta cooperativa não está habilitada para transporte PCD nesta viagem.';
  end if;
  update excursions set pcd_cooperativa_confirmado_em=now(), pcd_cooperativa_confirmado_por=auth.uid(), pcd_cooperativa_veiculo=nullif(trim(p_vehicle),''), pcd_cooperativa_motorista=nullif(trim(p_driver),'') where id=v.id;
  insert into notifications(user_id, excursion_id, title, message)
    select p.id, v.id, 'Transporte PCD confirmado', 'A cooperativa confirmou o transporte PCD da viagem de ' || to_char(v.trip_date,'DD/MM/YYYY') || coalesce('. Veículo: ' || nullif(trim(p_vehicle),''), '') || coalesce('. Motorista: ' || nullif(trim(p_driver),''), '') || '.'
    from profiles p where p.active and (p.role in ('admin','pedagogia') or (p.role='escola' and p.school_id=v.school_id));
end; $$;

revoke all on function public.agent_accept_atf(uuid) from public;
revoke all on function public.agent_confirm_pcd(uuid,text,text) from public;
grant execute on function public.agent_accept_atf(uuid) to authenticated;
grant execute on function public.agent_confirm_pcd(uuid,text,text) to authenticated;
