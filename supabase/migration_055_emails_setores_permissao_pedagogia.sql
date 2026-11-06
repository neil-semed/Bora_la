-- ============================================================
-- BORA LÁ - migration_055: e-mail dos setores pedagógicos, histórico dos e-mails automáticos
-- e permissão individual da Pedagogia para registrar solicitações.
-- Seguro rodar mais de uma vez. Rodar depois da migration_054.
-- ============================================================

-- 1. E-mail de cada setor pedagógico (um ou mais, separados por vírgula).
alter table public.validation_sectors add column if not exists email text;

-- 2. Histórico: e-mails automáticos (nova solicitação, proposta para análise) em "E-mails enviados".
alter table public.email_envios drop constraint if exists email_envios_modalidade_check;
alter table public.email_envios add constraint email_envios_modalidade_check check (modalidade in ('um', 'varios', 'todas', 'automatico'));

create or replace function public.registrar_email_automatico(p_assunto text, p_mensagem text, p_destinatarios jsonb, p_status text, p_erro text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.active) then
    raise exception 'Usuário sem permissão.';
  end if;
  insert into public.email_envios (sent_by, assunto, mensagem, modalidade, destinatarios, status, erro)
  values (auth.uid(), left(coalesce(p_assunto, ''), 300), left(coalesce(p_mensagem, ''), 5000), 'automatico',
          coalesce(p_destinatarios, '[]'::jsonb), case when p_status = 'falhou' then 'falhou' else 'enviado' end, left(p_erro, 1000))
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.registrar_email_automatico(text, text, jsonb, text, text) from public;
grant execute on function public.registrar_email_automatico(text, text, jsonb, text, text) to authenticated;

-- 3. Pedagogia: registrar solicitações = liberado para o perfil todo (Perfis de acesso)
--    OU liberado para a pessoa (tela Validadores). Os usuários existentes começam sem.
alter table public.profiles add column if not exists pode_registrar_solicitacao boolean not null default false;

create or replace function public.pedagogia_pode_registrar()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_name() = 'pedagogia' and (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.pode_registrar_solicitacao)
    or exists (select 1 from public.role_screen_permissions r where r.role = 'pedagogia' and r.screen_key = 'solicitacao' and r.can_view)
  );
$$;
grant execute on function public.pedagogia_pode_registrar() to authenticated;

-- Admin e Co_Admin (Validadores · editar) definem a permissão de cada validador.
create or replace function public.definir_permissao_solicitacao(p_profile uuid, p_valor boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.current_role_name() = 'admin' or public.has_access_permission('validadores', true)) then
    raise exception 'Sem permissão para alterar validadores.';
  end if;
  update public.profiles set pode_registrar_solicitacao = coalesce(p_valor, false) where id = p_profile and role = 'pedagogia';
  if not found then raise exception 'Validador não encontrado.'; end if;
end; $$;
revoke all on function public.definir_permissao_solicitacao(uuid, boolean) from public;
grant execute on function public.definir_permissao_solicitacao(uuid, boolean) to authenticated;

drop policy if exists "excursions_pedagogia_insert" on public.excursions;
create policy "excursions_pedagogia_insert" on public.excursions for insert with check (
  public.pedagogia_pode_registrar() and school_id is not null and created_by = auth.uid()
);
drop policy if exists "pcd_students_pedagogia_insert" on public.excursion_pcd_students;
create policy "pcd_students_pedagogia_insert" on public.excursion_pcd_students for insert with check (
  public.pedagogia_pode_registrar()
  and exists (select 1 from public.excursions e where e.id = excursion_pcd_students.excursion_id and e.created_by = auth.uid())
);

-- Sem a permissão, a Pedagogia também não envia proposta, nem das viagens que registrou.
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
    if old.created_by = auth.uid() and public.pedagogia_pode_registrar() then
      campos := campos || array['doc_filename','doc_drive_file_id','doc_drive_url','doc_uploaded_at'];
    end if;
    if (to_jsonb(new) - campos) is distinct from (to_jsonb(old) - campos) then
      raise exception 'A Pedagogia só pode registrar o parecer da proposta pedagógica e encaminhar o setor.';
    end if;
    if new.doc_status is distinct from old.doc_status
       and new.doc_status not in ('aceito','correcoes','rejeitado')
       and not (old.created_by = auth.uid() and public.pedagogia_pode_registrar() and new.doc_status = 'em_analise') then
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

notify pgrst, 'reload schema';
