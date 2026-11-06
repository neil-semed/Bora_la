-- ============================================================
-- BORA LÁ - migration_054: Pedagogia registra solicitações e usuário Pedagogo(a) da unidade
--  1. Função na unidade no perfil Escola (Direção / Pedagogo(a)) e menus próprios do Pedagogo(a).
--  2. Pedagogia cria viagens para qualquer unidade, com validador específico opcional,
--     e envia a proposta das viagens que registrou (ou a solicita à unidade).
-- Seguro rodar mais de uma vez.
-- ============================================================

-- 1. Função na unidade + menus do Pedagogo(a) (chave "escola_pedagogo").
alter table public.profiles add column if not exists funcao_unidade text;
alter table public.profiles drop constraint if exists profiles_funcao_unidade_check;
alter table public.profiles add constraint profiles_funcao_unidade_check check (funcao_unidade is null or funcao_unidade in ('direcao','pedagogo'));

alter table public.role_screen_permissions drop constraint if exists role_screen_permissions_role_check;
alter table public.role_screen_permissions add constraint role_screen_permissions_role_check
  check (role in ('escola','escola_pedagogo','pedagogia','motorista','agente_externo','financeiro'));

-- 2. Validador específico da proposta.
alter table public.excursions add column if not exists validator_profile_id uuid references public.profiles(id) on delete set null;

-- 3. Pedagogia cria viagens (unidade cadastrada obrigatória; autor = quem registrou).
drop policy if exists "excursions_pedagogia_insert" on public.excursions;
create policy "excursions_pedagogia_insert" on public.excursions for insert with check (
  public.current_role_name() = 'pedagogia' and school_id is not null and created_by = auth.uid()
);

-- Mesmas travas do pedido da Escola: nasce pendente, sem decisões; a proposta pode nascer "solicitada".
create or replace function public.guard_excursion_insert_pedagogia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.current_role_name() <> 'pedagogia' then return new; end if;
  if new.validator_profile_id is not null and not exists (
       select 1 from public.profiles p where p.id = new.validator_profile_id and p.active and p.role = 'pedagogia') then
    raise exception 'Validador inválido.';
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(
    'status', 'pending', 'situacao', 'sem_validacao',
    'doc_status', case when new.doc_status = 'solicitada' then 'solicitada' else 'nao_enviado' end,
    'doc_parecer_comentario', case when new.doc_status = 'solicitada' then new.doc_parecer_comentario else null end,
    'admin_decision', 'pendente', 'admin_decision_by', null, 'admin_decision_at', null, 'admin_decision_reason', null,
    'admin_processed_at', null, 'admin_processed_by', null,
    'pedagogy_approved_by', null, 'pedagogy_approved_at', null,
    'doc_parecer_por', null, 'doc_parecer_em', null,
    'atf_emitida_por', null, 'atf_emitida_em', null,
    'escola_confirmada_em', null, 'escola_confirmada_por', null,
    'finance_request_id', null, 'pcd_coop_id', null, 'created_by', auth.uid()));
  return new;
end; $$;
drop trigger if exists trg_guard_excursion_insert_pedagogia on public.excursions;
create trigger trg_guard_excursion_insert_pedagogia before insert on public.excursions
  for each row execute function public.guard_excursion_insert_pedagogia();

-- Lista PCD das viagens que a Pedagogia registrou.
drop policy if exists "pcd_students_pedagogia_insert" on public.excursion_pcd_students;
create policy "pcd_students_pedagogia_insert" on public.excursion_pcd_students for insert with check (
  public.current_role_name() = 'pedagogia'
  and exists (select 1 from public.excursions e where e.id = excursion_pcd_students.excursion_id and e.created_by = auth.uid())
);

-- 4. Alteração de viagens (igual à migration_045; muda só o trecho da Pedagogia).
create or replace function public.guard_excursion_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare role_name text := public.current_role_name(); campos text[];
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
      if ((old.trip_date + coalesce(old.departure_time, time '00:00')) at time zone 'America/Sao_Paulo') - interval '2 hours' < now() then
        raise exception 'Cancelamento permitido até 2 h antes da saída.';
      end if;
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
    -- Parecer e encaminhamento; nas viagens que a própria Pedagogia registrou, também o envio da proposta.
    campos := array['pedagogy_approved_by','pedagogy_approved_at','doc_status','doc_parecer_comentario','doc_parecer_por','doc_parecer_em','setor_pedagogico_atual','validation_sector_id'];
    if old.created_by = auth.uid() then
      campos := campos || array['doc_filename','doc_drive_file_id','doc_drive_url','doc_uploaded_at'];
    end if;
    if (to_jsonb(new) - campos) is distinct from (to_jsonb(old) - campos) then
      raise exception 'A Pedagogia só pode registrar o parecer da proposta pedagógica e encaminhar o setor.';
    end if;
    if new.doc_status is distinct from old.doc_status
       and new.doc_status not in ('aceito','correcoes','rejeitado')
       and not (old.created_by = auth.uid() and new.doc_status = 'em_analise') then
      raise exception 'Parecer pedagógico inválido.';
    end if;
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

-- 5. Avisos: validação atrelada a um validador avisa só essa pessoa (igual à migration_045 no resto).
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
  elsif p_grupo not in ('admins', 'usuario') then
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
  elsif p_grupo = 'validadores' and v.validator_profile_id is not null and p_alvo is null
        and exists (select 1 from public.profiles p where p.id = v.validator_profile_id and p.active and p.role = 'pedagogia') then
    -- Validação atrelada a um validador específico: só ele é avisado.
    insert into public.notifications(user_id, excursion_id, title, message) values (v.validator_profile_id, v.id, titulo, mensagem);
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
  elsif p_grupo = 'usuario' then
    if papel not in ('admin', 'operacional') then raise exception 'Somente a administração responde dúvidas.'; end if;
    insert into public.notifications(user_id, excursion_id, title, message)
    select p.id, p_excursion_id, titulo, mensagem from public.profiles p where p.id = p_alvo and p.active;
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

notify pgrst, 'reload schema';
