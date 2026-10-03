-- Bora Lá | Respostas da cooperativa (ATF e PCD) com vínculo pelo veículo.
-- Execute uma vez no SQL Editor, DEPOIS da migration_034.
-- As funções conferiam a cooperativa apenas por drivers.cooperativa_id; motoristas
-- vinculados à cooperativa somente pelo veículo geravam erro ao aprovar/recusar.
-- Usa public.motorista_da_cooperativa_atual(), criada na migration_034.

create or replace function public.agent_accept_atf(p_excursion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode confirmar ATF.'; end if;
  select * into v from excursions where id = p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if not exists (select 1 from excursion_drivers ed where ed.excursion_id = v.id and public.motorista_da_cooperativa_atual(ed.driver_id))
     or not exists (select 1 from cooperativas c where c.id = public.current_cooperativa_id() and c.opera_atf) then
    raise exception 'Esta cooperativa não está vinculada ou não opera ATF para esta viagem.';
  end if;
  perform set_config('app.bora_la_system_write','true',true);
  update excursions set atf_status='emitida', atf_emitida_por=auth.uid(), atf_emitida_em=now(),
    atf_cooperativa_response='aceita', atf_cooperativa_response_at=now(),
    situacao=case when situacao='aguarda_atf' then 'aprovada' else situacao end
  where id=v.id;
  insert into notifications(user_id,excursion_id,title,message)
  select p.id,v.id,'ATF emitida pela cooperativa','A cooperativa confirmou a emissão da ATF da viagem de ' || to_char(v.trip_date,'DD/MM/YYYY') || '.' from profiles p where p.active and (p.role in ('admin','pedagogia') or (p.role='escola' and p.school_id=v.school_id));
end; $$;

create or replace function public.agent_reject_atf(p_excursion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode responder à ATF.'; end if;
  select * into v from public.excursions where id=p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if not exists (select 1 from public.excursion_drivers ed where ed.excursion_id=v.id and public.motorista_da_cooperativa_atual(ed.driver_id)) then raise exception 'Esta viagem não pertence à sua cooperativa.'; end if;
  perform set_config('app.bora_la_system_write','true',true);
  update public.excursions set atf_cooperativa_response='rejeitada', atf_cooperativa_response_at=now() where id=v.id;
  insert into public.notifications(user_id,excursion_id,title,message)
  select p.id,v.id,'Cooperativa recusou ATF','A cooperativa informou que não emitirá a ATF. Entre em contato com o Administrador SEMED.' from public.profiles p where p.active and p.role='admin';
end; $$;

create or replace function public.agent_confirm_pcd(p_excursion_id uuid,p_vehicle text default null,p_driver text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode confirmar transporte PCD.'; end if;
  select * into v from excursions where id=p_excursion_id for update;
  if not found or coalesce(v.pca_count,0)=0 then raise exception 'Esta viagem não possui aluno PCD para confirmar.'; end if;
  if not exists (select 1 from excursion_drivers ed where ed.excursion_id=v.id and public.motorista_da_cooperativa_atual(ed.driver_id))
     or not exists (select 1 from cooperativas c where c.id = public.current_cooperativa_id() and c.opera_pcd) then
    raise exception 'Esta cooperativa não está habilitada para transporte PCD nesta viagem.';
  end if;
  perform set_config('app.bora_la_system_write','true',true);
  update excursions set pcd_cooperativa_confirmado_em=now(),pcd_cooperativa_confirmado_por=auth.uid(),pcd_cooperativa_veiculo=nullif(trim(p_vehicle),''),pcd_cooperativa_motorista=nullif(trim(p_driver),'') where id=v.id;
  insert into notifications(user_id,excursion_id,title,message)
  select p.id,v.id,'Transporte PCD confirmado','A cooperativa confirmou o transporte PCD da viagem de ' || to_char(v.trip_date,'DD/MM/YYYY') || coalesce('. Veículo: ' || nullif(trim(p_vehicle),''),'') || coalesce('. Motorista: ' || nullif(trim(p_driver),''), '') || '.' from profiles p where p.active and (p.role in ('admin','pedagogia') or (p.role='escola' and p.school_id=v.school_id));
end; $$;

create or replace function public.agent_reject_pcd(p_excursion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode responder ao PCD.'; end if;
  select * into v from public.excursions where id=p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if not exists (select 1 from public.excursion_drivers ed where ed.excursion_id=v.id and public.motorista_da_cooperativa_atual(ed.driver_id)) then raise exception 'Esta viagem não pertence à sua cooperativa.'; end if;
  perform set_config('app.bora_la_system_write','true',true);
  update public.excursions set pcd_cooperativa_response='negada', pcd_cooperativa_response_at=now() where id=v.id;
  insert into public.notifications(user_id,excursion_id,title,message)
  select p.id,v.id,'Transporte PCD negado','A cooperativa informou que não atenderá o transporte PCD desta solicitação.' from public.profiles p where p.active and (p.role in ('admin','pedagogia') or (p.role='escola' and p.school_id=v.school_id));
end; $$;

grant execute on function public.agent_accept_atf(uuid) to authenticated;
grant execute on function public.agent_reject_atf(uuid) to authenticated;
grant execute on function public.agent_confirm_pcd(uuid,text,text) to authenticated;
grant execute on function public.agent_reject_pcd(uuid) to authenticated;
