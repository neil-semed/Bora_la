-- Bora Lá | Correções dos perfis Escola, Pedagogia e Cooperativa (relatório de falhas).
-- Execute uma vez no SQL Editor, DEPOIS da migration_043.
-- O Admin continua sem restrição em todas as regras abaixo.

-- ============================================================================
-- C12 | Cooperativa do motorista: mesma regra da tela.
-- Veículo com cooperativa informada decide; sem cooperativa no veículo, vale o
-- vínculo antigo do motorista (drivers.cooperativa_id).
-- ============================================================================
create or replace function public.cooperativa_do_motorista(p_driver uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case
    when coalesce(trim(v.cooperative), '') <> '' then (
      select c.id from public.cooperativas c
      where v.cooperative = c.id::text or lower(trim(v.cooperative)) = lower(trim(c.name))
      limit 1)
    else d.cooperativa_id
  end
  from public.drivers d
  left join public.vehicles v on v.id = d.vehicle_id
  where d.id = p_driver;
$$;

create or replace function public.motorista_da_cooperativa_atual(p_driver uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_cooperativa_id() is not null
     and public.cooperativa_do_motorista(p_driver) = public.current_cooperativa_id();
$$;

grant execute on function public.cooperativa_do_motorista(uuid) to authenticated;

-- ============================================================================
-- Novas colunas
-- ============================================================================
alter table public.excursions add column if not exists pcd_coop_id uuid references public.cooperativas(id) on delete set null;
alter table public.excursions add column if not exists pcd_cooperativa_obs text;
alter table public.driver_km_logs add column if not exists cooperativa_id uuid references public.cooperativas(id) on delete set null;

-- ============================================================================
-- E1 / P3 / C9 | Notificações entre perfis (o banco só deixava o Admin notificar).
-- Os destinatários são definidos aqui, nunca pelo navegador.
-- ============================================================================
create or replace function public.pode_ver_viagem(p_excursion uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_role_name()
    when 'admin' then true
    when 'operacional' then true
    when 'pedagogia' then true
    when 'escola' then exists (select 1 from public.excursions e where e.id = p_excursion and e.school_id = public.current_school_id())
    when 'agente_externo' then public.viagem_da_cooperativa_atual(p_excursion)
    when 'motorista' then exists (select 1 from public.excursion_drivers ed where ed.excursion_id = p_excursion and ed.driver_id = public.current_driver_id())
    else false end;
$$;

create or replace function public.notificar_grupo(p_grupo text, p_excursion_id uuid, p_titulo text, p_mensagem text, p_alvo uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  papel text := public.current_role_name();
  v public.excursions%rowtype;
  setor uuid;
  n integer := 0;
  titulo text := left(coalesce(nullif(trim(p_titulo), ''), 'Aviso'), 200);
  mensagem text := left(coalesce(p_mensagem, ''), 2000);
begin
  if auth.uid() is null or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.active) then
    raise exception 'Usuário sem permissão para notificar.';
  end if;
  if p_excursion_id is not null then
    select * into v from public.excursions where id = p_excursion_id;
    if not found then raise exception 'Viagem não encontrada.'; end if;
    if not public.pode_ver_viagem(p_excursion_id) then raise exception 'Sem acesso a esta viagem.'; end if;
  elsif p_grupo <> 'admins' then
    raise exception 'Informe a viagem do aviso.';
  end if;

  if p_grupo = 'admins' then
    insert into public.notifications(user_id, excursion_id, title, message)
    select p.id, p_excursion_id, titulo, mensagem from public.profiles p where p.active and p.role = 'admin';
  elsif p_grupo = 'solicitante' then
    -- Quem criou a solicitação (login da escola); sem esse vínculo, os logins da unidade.
    if exists (select 1 from public.profiles p where p.id = v.created_by and p.active and p.role = 'escola') then
      insert into public.notifications(user_id, excursion_id, title, message) values (v.created_by, v.id, titulo, mensagem);
    else
      insert into public.notifications(user_id, excursion_id, title, message)
      select p.id, v.id, titulo, mensagem from public.profiles p
      where p.active and p.role = 'escola' and v.school_id is not null and p.school_id = v.school_id;
    end if;
  elsif p_grupo = 'unidade' then
    insert into public.notifications(user_id, excursion_id, title, message)
    select p.id, v.id, titulo, mensagem from public.profiles p
    where p.active and p.role = 'escola' and v.school_id is not null and p.school_id = v.school_id;
  elsif p_grupo = 'motoristas' then
    insert into public.notifications(user_id, excursion_id, title, message)
    select p.id, v.id, titulo, mensagem from public.profiles p
    where p.active and p.role = 'motorista'
      and p.driver_id in (select ed.driver_id from public.excursion_drivers ed where ed.excursion_id = v.id);
  elsif p_grupo = 'validadores' then
    setor := coalesce(p_alvo, v.validation_sector_id);
    if setor is not null and exists (select 1 from public.validator_sector_assignments a join public.profiles p on p.id = a.profile_id and p.active where a.sector_id = setor) then
      insert into public.notifications(user_id, excursion_id, title, message)
      select distinct p.id, v.id, titulo, mensagem from public.validator_sector_assignments a
      join public.profiles p on p.id = a.profile_id
      where a.sector_id = setor and p.active and p.role = 'pedagogia';
    else
      insert into public.notifications(user_id, excursion_id, title, message)
      select p.id, v.id, titulo, mensagem from public.profiles p where p.active and p.role = 'pedagogia';
    end if;
  elsif p_grupo = 'cooperativa' then
    if papel not in ('admin', 'operacional') then raise exception 'Somente a administração notifica cooperativas.'; end if;
    insert into public.notifications(user_id, excursion_id, title, message)
    select p.id, v.id, titulo, mensagem from public.profiles p
    where p.active and p.role = 'agente_externo' and p.cooperativa_id = p_alvo;
  else
    raise exception 'Grupo de aviso inválido.';
  end if;
  get diagnostics n = row_count;
  return n;
end; $$;

revoke all on function public.notificar_grupo(text, uuid, text, text, uuid) from public;
grant execute on function public.notificar_grupo(text, uuid, text, text, uuid) to authenticated;
grant execute on function public.pode_ver_viagem(uuid) to authenticated;

-- ============================================================================
-- E2 / E5 / P11 | Regras de alteração de viagens por perfil.
-- Mesma função da migration_032, com três ajustes:
--   Escola: pode gravar o vínculo do aporte (só quando vazio); só muda a situação
--           para "cancelada" e apenas antes de a viagem iniciar.
--   Pedagogia: só grava o parecer/setor (não altera solicitação nem ATF).
-- ============================================================================
create or replace function public.guard_excursion_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare role_name text := public.current_role_name();
begin
  if current_setting('app.bora_la_system_write', true) = 'true' then return new; end if;
  if current_setting('app.passenger_portal_write', true) = 'true' then
    if (to_jsonb(new) - array['passenger_access_status','passenger_access_submitted_at','listagem_status','listagem_enviada_em','listagem_parecer_comentario']) is distinct from
       (to_jsonb(old) - array['passenger_access_status','passenger_access_submitted_at','listagem_status','listagem_enviada_em','listagem_parecer_comentario']) then
      raise exception 'Alteração inválida pelo portal de passageiros.';
    end if;
    return new;
  end if;
  if role_name = 'admin' then return new; end if;
  if role_name = 'operacional' and (public.has_access_permission('agenda', true) or public.has_access_permission('validacoes', true)) then return new; end if;

  if role_name = 'escola' then
    if new.school_id is distinct from public.current_school_id() then raise exception 'A escola só pode alterar viagens da própria unidade.'; end if;
    if (to_jsonb(new) - array['situacao','cancel_reason','cancelled_by','cancelled_at','doc_filename','doc_drive_file_id','doc_drive_url','doc_uploaded_at','doc_status','doc_parecer_comentario','listagem_status','listagem_enviada_em','atf_lista_enviada_em','listagem_parecer_comentario','escola_confirmada_em','escola_confirmada_por','finance_request_id']) is distinct from
       (to_jsonb(old) - array['situacao','cancel_reason','cancelled_by','cancelled_at','doc_filename','doc_drive_file_id','doc_drive_url','doc_uploaded_at','doc_status','doc_parecer_comentario','listagem_status','listagem_enviada_em','atf_lista_enviada_em','listagem_parecer_comentario','escola_confirmada_em','escola_confirmada_por','finance_request_id']) then
      raise exception 'A escola só pode cancelar a própria viagem, enviar seu documento ou enviar sua listagem.';
    end if;
    if new.finance_request_id is distinct from old.finance_request_id and old.finance_request_id is not null then
      raise exception 'O aporte desta viagem já está vinculado.';
    end if;
    if new.situacao is distinct from old.situacao then
      if new.situacao <> 'cancelada' then raise exception 'A escola só pode cancelar a viagem.'; end if;
      if old.status in ('in_transit', 'completed') then raise exception 'Viagem já iniciada ou concluída — não é possível cancelar.'; end if;
    end if;
    if new.cancelled_by is distinct from old.cancelled_by and new.cancelled_by <> auth.uid() then raise exception 'Cancelamento inválido.'; end if;
    if new.escola_confirmada_em is distinct from old.escola_confirmada_em or new.escola_confirmada_por is distinct from old.escola_confirmada_por then
      if old.escola_confirmada_em is not null then raise exception 'A viagem já foi confirmada pela unidade.'; end if;
      if new.escola_confirmada_em is null or new.escola_confirmada_por is distinct from auth.uid() then raise exception 'Confirmação inválida.'; end if;
      if coalesce(old.admin_decision, '') <> 'aprovada' then raise exception 'A confirmação só é liberada após a aprovação do Admin.'; end if;
    end if;
    if new.doc_status is distinct from old.doc_status and new.doc_status <> 'em_analise' then raise exception 'A escola só pode enviar documento para análise.'; end if;
    if new.listagem_status is distinct from old.listagem_status and not (new.listagem_status = 'enviada' and old.listagem_status in ('nao_enviada','rejeitada')) then raise exception 'A escola só pode enviar ou reenviar sua listagem.'; end if;
    if new.listagem_parecer_comentario is distinct from old.listagem_parecer_comentario
       and not (old.listagem_status = 'rejeitada' and new.listagem_status = 'enviada' and new.listagem_parecer_comentario is null) then
      raise exception 'A observação da listagem só pode ser limpa ao reenviar uma listagem rejeitada.';
    end if;
    return new;
  end if;

  if role_name = 'pedagogia' then
    if (to_jsonb(new) - array['pedagogy_approved_by','pedagogy_approved_at','doc_status','doc_parecer_comentario','doc_parecer_por','doc_parecer_em','setor_pedagogico_atual','validation_sector_id']) is distinct from
       (to_jsonb(old) - array['pedagogy_approved_by','pedagogy_approved_at','doc_status','doc_parecer_comentario','doc_parecer_por','doc_parecer_em','setor_pedagogico_atual','validation_sector_id']) then
      raise exception 'A Pedagogia só pode registrar o parecer da proposta pedagógica e encaminhar o setor.';
    end if;
    if new.doc_status is distinct from old.doc_status and new.doc_status not in ('aceito','correcoes','rejeitado') then raise exception 'Parecer pedagógico inválido.'; end if;
    if (new.pedagogy_approved_by is distinct from old.pedagogy_approved_by and new.pedagogy_approved_by <> auth.uid()) or (new.doc_parecer_por is distinct from old.doc_parecer_por and new.doc_parecer_por <> auth.uid()) then raise exception 'Autor do parecer inválido.'; end if;
    return new;
  end if;
  if role_name = 'motorista' then
    if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then raise exception 'O motorista só pode alterar o andamento da viagem.'; end if;
    if not ((old.status = 'approved' and new.status = 'in_transit') or (old.status = 'in_transit' and new.status = 'completed')) then raise exception 'Transição de viagem inválida.'; end if;
    return new;
  end if;
  raise exception 'Perfil sem permissão para alterar viagens.';
end; $$;

-- ============================================================================
-- E6 | Solicitação criada pela escola sempre nasce pendente / sem validação.
-- ============================================================================
create or replace function public.guard_excursion_insert_escola()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.current_role_name() <> 'escola' then return new; end if;
  -- Chaves inexistentes na tabela são ignoradas pelo jsonb_populate_record.
  new := jsonb_populate_record(new, jsonb_build_object(
    'status', 'pending', 'situacao', 'sem_validacao', 'doc_status', 'nao_enviado',
    'admin_decision', 'pendente', 'admin_decision_by', null, 'admin_decision_at', null, 'admin_decision_reason', null,
    'admin_processed_at', null, 'admin_processed_by', null,
    'pedagogy_approved_by', null, 'pedagogy_approved_at', null,
    'doc_parecer_por', null, 'doc_parecer_em', null, 'doc_parecer_comentario', null,
    'atf_emitida_por', null, 'atf_emitida_em', null,
    'escola_confirmada_em', null, 'escola_confirmada_por', null,
    'finance_request_id', null, 'pcd_coop_id', null));
  return new;
end; $$;

drop trigger if exists trg_guard_excursion_insert_escola on public.excursions;
create trigger trg_guard_excursion_insert_escola before insert on public.excursions
  for each row execute function public.guard_excursion_insert_escola();

-- ============================================================================
-- C3 | Cooperativa lê somente passageiros/arquivos dos próprios veículos e a
-- lista PCD apenas quando opera PCD (e quando o pedido PCD é para ela).
-- ============================================================================
drop policy if exists "passengers_agente_coop_select" on public.excursion_passengers;
create policy "passengers_agente_coop_select" on public.excursion_passengers for select using (
  public.current_role_name() = 'agente_externo' and public.viagem_da_cooperativa_atual(excursion_id)
  and (driver_id is null or public.motorista_da_cooperativa_atual(driver_id))
);

drop policy if exists "listagem_files_agente_coop_select" on public.excursion_listagem_files;
create policy "listagem_files_agente_coop_select" on public.excursion_listagem_files for select using (
  public.current_role_name() = 'agente_externo' and public.viagem_da_cooperativa_atual(excursion_id)
  and (driver_id is null or public.motorista_da_cooperativa_atual(driver_id))
);

drop policy if exists "pcd_students_agente_coop_select" on public.excursion_pcd_students;
create policy "pcd_students_agente_coop_select" on public.excursion_pcd_students for select using (
  public.current_role_name() = 'agente_externo' and public.viagem_da_cooperativa_atual(excursion_id)
  and exists (select 1 from public.cooperativas c where c.id = public.current_cooperativa_id() and c.opera_pcd)
  and exists (select 1 from public.excursions e where e.id = excursion_id and (e.pcd_coop_id is null or e.pcd_coop_id = public.current_cooperativa_id()))
);

-- ============================================================================
-- C1 / C4 / C10 | Respostas da cooperativa à ATF: só veículos já enviados a ela;
-- o aceite devolve as placas confirmadas e as cooperativas que ainda faltam;
-- a recusa exige motivo.
-- ============================================================================
drop function if exists public.agent_accept_atf(uuid);
create function public.agent_accept_atf(p_excursion_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; mapa jsonb; d uuid; todas boolean; legado boolean; feitos uuid[] := array[]::uuid[];
  coop_nome text; placas text; pendentes jsonb; begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode confirmar ATF.'; end if;
  select * into v from excursions where id = p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if not exists (select 1 from excursion_drivers ed where ed.excursion_id = v.id and public.motorista_da_cooperativa_atual(ed.driver_id))
     or not exists (select 1 from cooperativas c where c.id = public.current_cooperativa_id() and c.opera_atf) then
    raise exception 'Esta cooperativa não está vinculada ou não opera ATF para esta viagem.';
  end if;
  mapa := coalesce(v.listagem_veiculos, '{}'::jsonb);
  legado := mapa = '{}'::jsonb;
  for d in select ed.driver_id from excursion_drivers ed where ed.excursion_id = v.id and public.motorista_da_cooperativa_atual(ed.driver_id) loop
    if legado or ((mapa -> d::text ->> 'coop_enviado_em') is not null and coalesce(mapa -> d::text ->> 'atf', '') <> 'aceita') then
      mapa := jsonb_set(mapa, array[d::text], coalesce(mapa -> d::text, '{}'::jsonb)
        || jsonb_build_object('atf', 'aceita', 'atf_em', now(), 'atf_por', auth.uid(), 'atf_origem', 'cooperativa', 'atf_obs', null));
      feitos := feitos || d;
    end if;
  end loop;
  if array_length(feitos, 1) is null then raise exception 'Nenhum veículo desta cooperativa aguarda ATF nesta viagem.'; end if;
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
  select name into coop_nome from cooperativas where id = public.current_cooperativa_id();
  select string_agg(coalesce(ve.plate, dr.name), ', ' order by coalesce(ve.plate, dr.name)) into placas
    from drivers dr left join vehicles ve on ve.id = dr.vehicle_id where dr.id = any(feitos);
  select coalesce(jsonb_agg(jsonb_build_object('cooperativa', x.nome, 'veiculos', x.n) order by x.nome), '[]'::jsonb) into pendentes
    from (select coalesce(c.name, 'Cooperativa não identificada') nome, count(*) n
          from excursion_drivers ed left join cooperativas c on c.id = public.cooperativa_do_motorista(ed.driver_id)
          where ed.excursion_id = v.id and coalesce(mapa -> ed.driver_id::text ->> 'atf', '') <> 'aceita'
          group by 1) x;
  insert into notifications(user_id,excursion_id,title,message)
  select p.id, v.id, 'ATF emitida — ' || coalesce(coop_nome, 'cooperativa'),
    'A cooperativa ' || coalesce(coop_nome, '') || ' emitiu a ATF da viagem de ' || to_char(v.trip_date,'DD/MM/YYYY')
    || ' (veículos: ' || coalesce(placas, '-') || ')' || case when todas then '. ATF da viagem concluída.' else '; aguardando as demais cooperativas.' end
  from profiles p where p.active and (p.role in ('admin','pedagogia') or (p.role='escola' and p.school_id=v.school_id));
  return jsonb_build_object('todas', todas, 'cooperativa', coop_nome, 'placas', placas, 'pendentes', pendentes);
end; $$;

drop function if exists public.agent_reject_atf(uuid);
drop function if exists public.agent_reject_atf(uuid, text);
create function public.agent_reject_atf(p_excursion_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; mapa jsonb; d uuid; legado boolean; feitos uuid[] := array[]::uuid[]; coop_nome text; motivo text := nullif(trim(coalesce(p_motivo, '')), ''); begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode responder à ATF.'; end if;
  if motivo is null then raise exception 'Informe o motivo da recusa.'; end if;
  select * into v from public.excursions where id=p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if not exists (select 1 from public.excursion_drivers ed where ed.excursion_id=v.id and public.motorista_da_cooperativa_atual(ed.driver_id)) then raise exception 'Esta viagem não pertence à sua cooperativa.'; end if;
  mapa := coalesce(v.listagem_veiculos, '{}'::jsonb);
  legado := mapa = '{}'::jsonb;
  for d in select ed.driver_id from public.excursion_drivers ed where ed.excursion_id = v.id and public.motorista_da_cooperativa_atual(ed.driver_id) loop
    if legado or ((mapa -> d::text ->> 'coop_enviado_em') is not null and coalesce(mapa -> d::text ->> 'atf', '') <> 'aceita') then
      mapa := jsonb_set(mapa, array[d::text], coalesce(mapa -> d::text, '{}'::jsonb)
        || jsonb_build_object('atf', 'rejeitada', 'atf_em', now(), 'atf_por', auth.uid(), 'atf_origem', 'cooperativa', 'atf_obs', motivo));
      feitos := feitos || d;
    end if;
  end loop;
  if array_length(feitos, 1) is null then raise exception 'Nenhum veículo desta cooperativa aguarda ATF nesta viagem.'; end if;
  perform set_config('app.bora_la_system_write','true',true);
  update public.excursions set listagem_veiculos = mapa, atf_cooperativa_response='rejeitada', atf_cooperativa_response_at=now() where id=v.id;
  select name into coop_nome from public.cooperativas where id = public.current_cooperativa_id();
  insert into public.notifications(user_id,excursion_id,title,message)
  select p.id, v.id, 'Cooperativa recusou ATF — ' || coalesce(coop_nome, ''),
    'A cooperativa ' || coalesce(coop_nome, '') || ' não emitirá a ATF da viagem de ' || to_char(v.trip_date,'DD/MM/YYYY') || '. Motivo: ' || motivo
  from public.profiles p where p.active and p.role='admin';
end; $$;

-- ============================================================================
-- C2 / C10 | PCD: somente a cooperativa para a qual o Admin enviou o pedido
-- (e que opera PCD) responde; a recusa exige motivo.
-- ============================================================================
create or replace function public.agent_confirm_pcd(p_excursion_id uuid,p_vehicle text default null,p_driver text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; coop_nome text; begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode confirmar transporte PCD.'; end if;
  select * into v from excursions where id=p_excursion_id for update;
  if not found or coalesce(v.pca_count,0)=0 then raise exception 'Esta viagem não possui aluno PCD para confirmar.'; end if;
  if v.pcd_coop_id is not null and v.pcd_coop_id <> public.current_cooperativa_id() then raise exception 'O pedido PCD desta viagem foi enviado a outra cooperativa.'; end if;
  if not exists (select 1 from excursion_drivers ed where ed.excursion_id=v.id and public.motorista_da_cooperativa_atual(ed.driver_id)) and v.pcd_coop_id is null
     or not exists (select 1 from cooperativas c where c.id = public.current_cooperativa_id() and c.opera_pcd) then
    raise exception 'Esta cooperativa não está habilitada para transporte PCD nesta viagem.';
  end if;
  perform set_config('app.bora_la_system_write','true',true);
  update excursions set pcd_cooperativa_confirmado_em=now(),pcd_cooperativa_confirmado_por=auth.uid(),pcd_cooperativa_veiculo=nullif(trim(p_vehicle),''),pcd_cooperativa_motorista=nullif(trim(p_driver),''),pcd_cooperativa_obs=null where id=v.id;
  select name into coop_nome from cooperativas where id = public.current_cooperativa_id();
  insert into notifications(user_id,excursion_id,title,message)
  select p.id,v.id,'Transporte PCD confirmado — ' || coalesce(coop_nome, ''),'A cooperativa ' || coalesce(coop_nome, '') || ' confirmou o transporte PCD da viagem de ' || to_char(v.trip_date,'DD/MM/YYYY') || coalesce('. Veículo: ' || nullif(trim(p_vehicle),''),'') || coalesce('. Motorista: ' || nullif(trim(p_driver),''), '') || '.' from profiles p where p.active and (p.role in ('admin','pedagogia') or (p.role='escola' and p.school_id=v.school_id));
end; $$;

drop function if exists public.agent_reject_pcd(uuid);
drop function if exists public.agent_reject_pcd(uuid, text);
create function public.agent_reject_pcd(p_excursion_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; coop_nome text; motivo text := nullif(trim(coalesce(p_motivo, '')), ''); begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode responder ao PCD.'; end if;
  if motivo is null then raise exception 'Informe o motivo da recusa.'; end if;
  select * into v from public.excursions where id=p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if v.pcd_coop_id is not null and v.pcd_coop_id <> public.current_cooperativa_id() then raise exception 'O pedido PCD desta viagem foi enviado a outra cooperativa.'; end if;
  if not exists (select 1 from public.cooperativas c where c.id = public.current_cooperativa_id() and c.opera_pcd) then raise exception 'Esta cooperativa não opera transporte PCD.'; end if;
  if v.pcd_coop_id is null and not exists (select 1 from public.excursion_drivers ed where ed.excursion_id=v.id and public.motorista_da_cooperativa_atual(ed.driver_id)) then raise exception 'Esta viagem não pertence à sua cooperativa.'; end if;
  perform set_config('app.bora_la_system_write','true',true);
  update public.excursions set pcd_cooperativa_response='negada', pcd_cooperativa_response_at=now(), pcd_cooperativa_obs=motivo where id=v.id;
  select name into coop_nome from public.cooperativas where id = public.current_cooperativa_id();
  insert into public.notifications(user_id,excursion_id,title,message)
  select p.id,v.id,'Transporte PCD negado — ' || coalesce(coop_nome, ''),'A cooperativa ' || coalesce(coop_nome, '') || ' não atenderá o transporte PCD da viagem de ' || to_char(v.trip_date,'DD/MM/YYYY') || '. Motivo: ' || motivo from public.profiles p where p.active and (p.role in ('admin','pedagogia') or (p.role='escola' and p.school_id=v.school_id));
end; $$;

grant execute on function public.agent_accept_atf(uuid) to authenticated;
grant execute on function public.agent_reject_atf(uuid, text) to authenticated;
grant execute on function public.agent_confirm_pcd(uuid,text,text) to authenticated;
grant execute on function public.agent_reject_pcd(uuid, text) to authenticated;

-- ============================================================================
-- C12 | KM: o registro guarda a cooperativa do momento do lançamento.
-- ============================================================================
create or replace function public.km_log_set_cooperativa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id or new.cooperativa_id is null then
    new.cooperativa_id := public.cooperativa_do_motorista(new.driver_id);
  end if;
  return new;
end; $$;

drop trigger if exists trg_km_log_set_cooperativa on public.driver_km_logs;
create trigger trg_km_log_set_cooperativa before insert or update on public.driver_km_logs
  for each row execute function public.km_log_set_cooperativa();

update public.driver_km_logs set cooperativa_id = public.cooperativa_do_motorista(driver_id) where cooperativa_id is null;

drop policy if exists "km_logs_select" on public.driver_km_logs;
create policy "km_logs_select" on public.driver_km_logs for select using (
  public.current_role_name() = 'admin'
  or (public.current_role_name() = 'motorista' and driver_id = public.current_driver_id())
  or (public.current_role_name() = 'agente_externo' and (
    cooperativa_id = public.current_cooperativa_id()
    or (cooperativa_id is null and public.motorista_da_cooperativa_atual(driver_id))
  ))
);
