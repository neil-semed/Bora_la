-- Bora Lá | Ajuda (fase 1): perguntas e respostas, dicas ⓘ, dúvidas dos operadores;
-- pedido de correção da listagem pela escola; cancelamento pela escola até 2 h antes.
-- Execute uma vez no SQL Editor, DEPOIS da migration_044. O Admin continua sem trava.

-- ============================================================================
-- Tabelas da Ajuda
-- ============================================================================
create table if not exists public.ajuda_faq (
  id uuid primary key default gen_random_uuid(),
  perfis text[] not null default '{}',          -- escola | pedagogia | cooperativa
  tela text,                                       -- chave da tela; nulo = todas
  pergunta text not null,
  resposta text not null,
  onde_clicar text,
  video_url text,
  ordem integer not null default 0,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ajuda_dicas (
  chave text primary key,
  titulo text not null,
  texto text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.ajuda_duvidas (
  id uuid primary key default gen_random_uuid(),
  autor uuid references public.profiles(id) on delete set null default auth.uid(),
  perfil text,
  tela text,
  texto text not null,
  status text not null default 'nova' check (status in ('nova', 'respondida', 'arquivada')),
  resposta text,
  respondida_por uuid references public.profiles(id) on delete set null,
  respondida_em timestamptz,
  created_at timestamptz not null default now()
);

alter table public.ajuda_faq enable row level security;
alter table public.ajuda_dicas enable row level security;
alter table public.ajuda_duvidas enable row level security;

-- Tela "Ajuda" no catálogo de perfis de acesso (Co_Admin edita).
alter table public.access_profile_permissions drop constraint if exists access_profile_permissions_screen_key_check;
alter table public.access_profile_permissions add constraint access_profile_permissions_screen_key_check
  check (screen_key in ('dashboard', 'pendencias', 'agenda', 'solicitacao', 'relatorios', 'validacoes', 'km', 'veiculos', 'motoristas', 'cooperativas', 'unidades', 'validadores', 'carrosolicitacoes', 'carronova', 'ajuda'));
insert into public.access_profile_permissions (access_profile_id, screen_key, can_view, can_edit)
select ap.id, 'ajuda', true, true from public.access_profiles ap
where ap.name = 'Co_Admin'
  and not exists (select 1 from public.access_profile_permissions pp where pp.access_profile_id = ap.id and pp.screen_key = 'ajuda');

create or replace function public.pode_editar_ajuda()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_name() = 'admin' or public.has_access_permission('ajuda', true);
$$;
grant execute on function public.pode_editar_ajuda() to authenticated;

drop policy if exists ajuda_faq_select on public.ajuda_faq;
create policy ajuda_faq_select on public.ajuda_faq for select using (auth.uid() is not null);
drop policy if exists ajuda_faq_write on public.ajuda_faq;
create policy ajuda_faq_write on public.ajuda_faq for all using (public.pode_editar_ajuda()) with check (public.pode_editar_ajuda());

drop policy if exists ajuda_dicas_select on public.ajuda_dicas;
create policy ajuda_dicas_select on public.ajuda_dicas for select using (auth.uid() is not null);
drop policy if exists ajuda_dicas_write on public.ajuda_dicas;
create policy ajuda_dicas_write on public.ajuda_dicas for all using (public.pode_editar_ajuda()) with check (public.pode_editar_ajuda());

drop policy if exists ajuda_duvidas_insert on public.ajuda_duvidas;
create policy ajuda_duvidas_insert on public.ajuda_duvidas for insert with check (auth.uid() is not null and autor = auth.uid() and status = 'nova');
drop policy if exists ajuda_duvidas_select on public.ajuda_duvidas;
create policy ajuda_duvidas_select on public.ajuda_duvidas for select using (autor = auth.uid() or public.pode_editar_ajuda());
drop policy if exists ajuda_duvidas_update on public.ajuda_duvidas;
create policy ajuda_duvidas_update on public.ajuda_duvidas for update using (public.pode_editar_ajuda()) with check (public.pode_editar_ajuda());

grant select, insert, update, delete on public.ajuda_faq, public.ajuda_dicas, public.ajuda_duvidas to authenticated;

-- Conteúdo inicial (só quando a tabela está vazia).
insert into public.ajuda_faq (perfis, tela, pergunta, resposta, onde_clicar, ordem)
select * from (values
  (array['escola'], 'solicitacao', 'Como faço um pedido de viagem?', 'Menu Nova solicitação › preencha os passos › Enviar solicitação.', null, 1),
  (array['escola'], 'solicitacao', 'Com quanto tempo de antecedência peço a viagem?', 'Dentro de Nova Lima: mínimo 36 h antes da saída. Fora de Nova Lima: mínimo 72 h.', null, 2),
  (array['escola'], 'solicitacao', 'Meu pedido garante a viagem?', 'Não. Depende de veículos e agenda disponíveis, informações corretas, validação pedagógica ou programação já definida.', null, 3),
  (array['escola'], 'pendencias', 'Como envio a proposta pedagógica?', 'No próprio pedido ou depois. PDF ou Word, até 8 MB.', 'Pendências › Enviar proposta', 4),
  (array['escola'], 'pendencias', 'Minha proposta foi rejeitada. E agora?', 'A viagem não foi cancelada. Leia o motivo e envie uma nova proposta.', 'Pendências › Enviar nova proposta', 5),
  (array['escola'], 'pendencias', 'A Pedagogia pediu correções. O que faço?', 'Leia o comentário e reenvie a proposta corrigida.', 'Pendências › Reenviar proposta', 6),
  (array['escola'], 'pendencias', 'Quando envio a listagem de passageiros?', 'Após a aprovação, nas viagens que pedem ATF. Até 48 h antes da saída.', 'Pendências › Preencher listagem', 7),
  (array['escola'], 'agenda', 'Por que não consigo enviar a listagem?', 'O prazo de 48 h antes da saída acabou. Fale com o Admin.', null, 8),
  (array['escola'], 'agenda', 'Preciso corrigir a listagem já enviada.', 'Antes da ATF: peça a correção ao Admin. Depois da ATF, não é possível alterar.', 'Listagem › Pedir correção ao Admin', 9),
  (array['escola'], 'agenda', 'Posso trocar passageiros entre os veículos?', 'Não. Os passageiros de cada veículo não podem ser trocados. A responsabilidade é da unidade.', null, 10),
  (array['escola'], 'pendencias', 'Como confirmo a viagem?', 'Após a aprovação do Admin, confirme a viagem.', 'Pendências › Confirmar', 11),
  (array['escola'], 'agenda', 'Até quando posso cancelar?', 'Até 2 h antes da saída, informando o motivo.', 'Agenda ou Validações › Cancelar', 12),
  (array['escola'], 'solicitacao', 'Viagem recorrente: envio proposta para cada data?', 'Não. Uma proposta vale para todas as datas.', null, 13),
  (array['escola'], 'solicitacao', 'O que preencho para aluno PCD?', 'Nome e documento do aluno e do apoio.', null, 14),
  (array['pedagogia'], 'pendencias', 'Onde vejo o que analisar?', 'Em Pendências e Validações, com as solicitações do seu setor.', null, 15),
  (array['pedagogia'], 'validacoes', 'Aceitei e a solicitação sumiu. Está certo?', 'Sim. Ela segue para a decisão do Admin.', null, 16),
  (array['pedagogia'], 'validacoes', 'Por que não consigo aceitar?', 'Só dá para aceitar proposta enviada e em análise. Sem documento, peça correções.', null, 17),
  (array['pedagogia'], 'validacoes', 'O documento não abre.', 'Clique em "Abrir documento em nova aba".', null, 18),
  (array['pedagogia'], 'validacoes', 'Correções ou rejeitar?', 'Correções: a escola ajusta e reenvia. Rejeitar: a escola envia nova proposta.', null, 19),
  (array['pedagogia'], 'validacoes', 'A solicitação caiu no setor errado.', 'Escolha o setor, informe o motivo e confirme.', 'Janela de validação › Encaminhar', 20),
  (array['pedagogia'], 'pendencias', 'O que é "Sem setor responsável"?', 'Pedido sem setor definido. Escolha o setor e encaminhe.', 'Pendências › Encaminhar', 21),
  (array['pedagogia'], 'validacoes', 'Série recorrente: analiso cada data?', 'Não. Analise a primeira; o parecer vale para todas.', null, 22),
  (array['pedagogia'], 'validacoes', 'Apareceu "nova versão ou outro parecer".', 'A proposta mudou. Feche, recarregue e analise de novo.', null, 23),
  (array['cooperativa'], 'pendenciascoop', 'Como sei que chegou um pedido?', 'Pelo aviso no sino e pelo card em Pendências.', null, 24),
  (array['cooperativa'], 'pendenciascoop', 'Como emito a ATF?', 'Abra o card e confirme a emissão.', 'Card › Aprovar e emitir ATF › Confirmar emissão', 25),
  (array['cooperativa'], 'pendenciascoop', 'Aprovei e a ATF não aparece emitida.', 'Há outra cooperativa na viagem. A ATF fica completa quando todas confirmarem.', null, 26),
  (array['cooperativa'], 'pendenciascoop', 'Como baixo a listagem?', 'No card: PDF, Excel ou Abrir listagem. Só aparecem os seus veículos.', null, 27),
  (array['cooperativa'], 'pendenciascoop', 'Como recuso um pedido?', 'Informe o motivo da recusa.', 'Card › Reprovar (ATF) ou Recusar (PCD)', 28),
  (array['cooperativa'], 'pendenciascoop', 'Por que recebi pedido PCD?', 'A SEMED enviou para a sua cooperativa, que opera PCD.', null, 29),
  (array['cooperativa'], 'km', 'Onde vejo o KM dos meus veículos?', 'Na tela KM, com filtros de motorista, ano e mês.', null, 30)
) as v(perfis, tela, pergunta, resposta, onde_clicar, ordem)
where not exists (select 1 from public.ajuda_faq);

insert into public.ajuda_dicas (chave, titulo, texto) values
  ('listagem_prazo', 'Prazo da listagem (cards e agenda)', 'A listagem para ATF deve ser enviada até 48 h antes da saída. Depois disso, fale com o Admin.'),
  ('listagem_aviso', 'Aviso na janela da listagem', 'Depois de enviada, a listagem não pode ser alterada. Após a emissão da ATF, não é possível editar nem incluir passageiros. Não pode haver troca de passageiros entre os veículos escalados — responsabilidade da unidade solicitante.'),
  ('solicitacao_antecedencia', 'Data — Nova solicitação', 'Pedido com no mínimo 36 h de antecedência (Nova Lima) ou 72 h (fora de Nova Lima).'),
  ('solicitacao_aviso', 'Aviso no topo da Nova solicitação (Escola)', 'O atendimento das solicitações depende da disponibilidade de veículos e de espaço na agenda, da exatidão das informações, da validação pedagógica ou de programação preestabelecida.'),
  ('proposta_rejeitada', 'Proposta rejeitada (Escola)', 'A rejeição é da proposta, não da viagem. Envie uma nova proposta.'),
  ('proposta_correcoes', 'Correções na proposta (Escola)', 'Leia o comentário e reenvie a proposta corrigida.'),
  ('cancelamento', 'Botão Cancelar (Escola)', 'Cancelamento até 2 h antes da saída.'),
  ('parecer_aceite', 'Parecer — janela de validação (Pedagogia)', 'Só é possível aceitar proposta enviada e em análise. Sem documento, peça correções.'),
  ('coop_atf', 'Botão Aprovar e emitir ATF (Cooperativa)', 'O aceite vale só para os seus veículos. A ATF da viagem fica completa quando todas as cooperativas confirmarem.'),
  ('coop_pcd', 'Transporte PCD (Cooperativa)', 'O pedido PCD vai só para a cooperativa escolhida pela SEMED. Informe veículo e motorista, se possível.')
on conflict (chave) do nothing;

-- ============================================================================
-- Resposta do Admin/Co_Admin à dúvida vai para o sino de quem perguntou (grupo "usuario").
-- ============================================================================
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

-- ============================================================================
-- Escola cancela até 2 h antes da saída (demais regras iguais à migration_044).
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
-- Escola pede ao Admin a correção da listagem de um veículo já enviado
-- (antes da ATF desse veículo e dentro do prazo de 48 h antes da saída).
-- ============================================================================
create or replace function public.school_request_listagem_correction(p_excursion_id uuid, p_driver_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; mapa jsonb; ent jsonb; motivo text := nullif(trim(coalesce(p_motivo, '')), ''); placa text; begin
  if public.current_role_name() <> 'escola' then raise exception 'Apenas a unidade pode pedir correção da listagem.'; end if;
  if motivo is null then raise exception 'Informe o que precisa ser corrigido.'; end if;
  select * into v from public.excursions where id = p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if v.school_id is distinct from public.current_school_id() then raise exception 'A escola só pode alterar viagens da própria unidade.'; end if;
  if not exists (select 1 from public.excursion_drivers ed where ed.excursion_id = v.id and ed.driver_id = p_driver_id) then raise exception 'Veículo não pertence a esta viagem.'; end if;
  if ((v.trip_date + coalesce(v.departure_time, time '00:00')) at time zone 'America/Sao_Paulo') - interval '48 hours' < now() then
    raise exception 'Prazo da listagem encerrado. Fale com o Admin.';
  end if;
  mapa := coalesce(v.listagem_veiculos, '{}'::jsonb);
  ent := coalesce(mapa -> p_driver_id::text, '{}'::jsonb);
  if coalesce(ent ->> 'atf', '') = 'aceita' or v.atf_status = 'emitida' then raise exception 'ATF já emitida — a listagem não pode ser alterada.'; end if;
  if coalesce(ent ->> 'status', v.listagem_status, 'nao_enviada') not in ('enviada', 'aceita') then raise exception 'Esta listagem ainda pode ser editada pela unidade.'; end if;
  if (ent ->> 'correcao_pedida_em') is not null then raise exception 'Já existe um pedido de correção aberto para este veículo.'; end if;
  mapa := jsonb_set(mapa, array[p_driver_id::text], ent || jsonb_build_object('correcao_pedida_em', now(), 'correcao_motivo', motivo, 'correcao_por', auth.uid()));
  perform set_config('app.bora_la_system_write', 'true', true);
  update public.excursions set listagem_veiculos = mapa where id = v.id;
  select coalesce(ve.plate, dr.name) into placa from public.drivers dr left join public.vehicles ve on ve.id = dr.vehicle_id where dr.id = p_driver_id;
  insert into public.notifications(user_id, excursion_id, title, message)
  select p.id, v.id, 'Pedido de correção da listagem',
    'A unidade pediu correção da listagem do veículo ' || coalesce(placa, '-') || ' (viagem de ' || to_char(v.trip_date, 'DD/MM/YYYY') || '): ' || motivo
  from public.profiles p where p.active and p.role = 'admin';
end; $$;
grant execute on function public.school_request_listagem_correction(uuid, uuid, text) to authenticated;
