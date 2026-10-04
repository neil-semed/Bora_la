-- Bora Lá | Aprovação da listagem e ATF por veículo.
-- Execute uma vez no SQL Editor, DEPOIS da migration_038.
-- excursions.listagem_veiculos (jsonb), por motorista/veículo da viagem:
--   status (enviada|aceita|rejeitada), motivo, parecer_em/por, enviada_em,
--   coop_enviado_em, coop_id, atf (aceita|rejeitada), atf_em/por, atf_origem, atf_obs.
-- Os campos antigos da viagem continuam como resumo (preenchidos quando todos os
-- veículos concluem a etapa). Viagens antigas (sem dados por veículo) seguem iguais.

alter table public.excursions add column if not exists listagem_veiculos jsonb not null default '{}'::jsonb;

-- Escola: marca como "enviada" somente os veículos submetidos (novos ou recusados).
create or replace function public.school_submit_listagem_veiculos(p_excursion_id uuid, p_driver_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; mapa jsonb; d uuid; atual text; begin
  if public.current_role_name() <> 'escola' then raise exception 'Apenas a unidade pode enviar a listagem.'; end if;
  select * into v from public.excursions where id = p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if v.school_id is distinct from public.current_school_id() then raise exception 'A escola só pode alterar viagens da própria unidade.'; end if;
  mapa := coalesce(v.listagem_veiculos, '{}'::jsonb);
  foreach d in array coalesce(p_driver_ids, array[]::uuid[]) loop
    if not exists (select 1 from public.excursion_drivers ed where ed.excursion_id = v.id and ed.driver_id = d) then
      raise exception 'Veículo não pertence a esta viagem.';
    end if;
    atual := mapa -> d::text ->> 'status';
    if atual is not null and atual not in ('nao_enviada', 'rejeitada') then
      raise exception 'A listagem deste veículo já foi enviada ou aceita.';
    end if;
    mapa := jsonb_set(mapa, array[d::text], coalesce(mapa -> d::text, '{}'::jsonb)
      || jsonb_build_object('status', 'enviada', 'enviada_em', now(), 'motivo', null, 'coop_enviado_em', null, 'atf', null, 'atf_em', null));
  end loop;
  perform set_config('app.bora_la_system_write', 'true', true);
  update public.excursions set listagem_veiculos = mapa where id = v.id;
end; $$;

-- Cooperativa: aprovar/emitir ATF grava somente os veículos dela; a viagem passa a
-- "Aprovada" (ATF emitida) apenas quando todos os veículos tiverem ATF aceita.
create or replace function public.agent_accept_atf(p_excursion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; mapa jsonb; d uuid; todas boolean; begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode confirmar ATF.'; end if;
  select * into v from excursions where id = p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if not exists (select 1 from excursion_drivers ed where ed.excursion_id = v.id and public.motorista_da_cooperativa_atual(ed.driver_id))
     or not exists (select 1 from cooperativas c where c.id = public.current_cooperativa_id() and c.opera_atf) then
    raise exception 'Esta cooperativa não está vinculada ou não opera ATF para esta viagem.';
  end if;
  mapa := coalesce(v.listagem_veiculos, '{}'::jsonb);
  for d in select ed.driver_id from excursion_drivers ed where ed.excursion_id = v.id and public.motorista_da_cooperativa_atual(ed.driver_id) loop
    mapa := jsonb_set(mapa, array[d::text], coalesce(mapa -> d::text, '{}'::jsonb)
      || jsonb_build_object('atf', 'aceita', 'atf_em', now(), 'atf_por', auth.uid(), 'atf_origem', 'cooperativa', 'atf_obs', null));
  end loop;
  select coalesce(bool_and(coalesce(mapa -> ed.driver_id::text ->> 'atf', '') = 'aceita'), false) into todas
    from excursion_drivers ed where ed.excursion_id = v.id;
  perform set_config('app.bora_la_system_write','true',true);
  if todas then
    update excursions set listagem_veiculos = mapa, atf_status='emitida', atf_emitida_por=auth.uid(), atf_emitida_em=now(),
      atf_cooperativa_response='aceita', atf_cooperativa_response_at=now(),
      situacao=case when situacao in ('cancelada','reprovada') then situacao else 'aprovada' end
    where id=v.id;
  else
    update excursions set listagem_veiculos = mapa where id = v.id;
  end if;
  insert into notifications(user_id,excursion_id,title,message)
  select p.id,v.id,'ATF emitida pela cooperativa','A cooperativa confirmou a emissão da ATF da viagem de ' || to_char(v.trip_date,'DD/MM/YYYY') || case when todas then '.' else ' (veículo(s) da cooperativa; aguardando os demais).' end
  from profiles p where p.active and (p.role in ('admin','pedagogia') or (p.role='escola' and p.school_id=v.school_id));
end; $$;

create or replace function public.agent_reject_atf(p_excursion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; mapa jsonb; d uuid; begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode responder à ATF.'; end if;
  select * into v from public.excursions where id=p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if not exists (select 1 from public.excursion_drivers ed where ed.excursion_id=v.id and public.motorista_da_cooperativa_atual(ed.driver_id)) then raise exception 'Esta viagem não pertence à sua cooperativa.'; end if;
  mapa := coalesce(v.listagem_veiculos, '{}'::jsonb);
  for d in select ed.driver_id from public.excursion_drivers ed where ed.excursion_id = v.id and public.motorista_da_cooperativa_atual(ed.driver_id) loop
    mapa := jsonb_set(mapa, array[d::text], coalesce(mapa -> d::text, '{}'::jsonb)
      || jsonb_build_object('atf', 'rejeitada', 'atf_em', now(), 'atf_por', auth.uid(), 'atf_origem', 'cooperativa'));
  end loop;
  perform set_config('app.bora_la_system_write','true',true);
  update public.excursions set listagem_veiculos = mapa, atf_cooperativa_response='rejeitada', atf_cooperativa_response_at=now() where id=v.id;
  insert into public.notifications(user_id,excursion_id,title,message)
  select p.id,v.id,'Cooperativa recusou ATF','A cooperativa informou que não emitirá a ATF. Entre em contato com o Administrador SEMED.' from public.profiles p where p.active and p.role='admin';
end; $$;

grant execute on function public.school_submit_listagem_veiculos(uuid, uuid[]) to authenticated;
grant execute on function public.agent_accept_atf(uuid) to authenticated;
grant execute on function public.agent_reject_atf(uuid) to authenticated;
