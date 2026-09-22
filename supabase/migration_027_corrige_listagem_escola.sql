-- Bora Lá | Correção do envio de listagens pela escola.
-- Execute este arquivo inteiro no SQL Editor depois da migration_026.
-- É seguro executá-lo mais de uma vez.

create or replace function public.guard_excursion_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare role_name text := public.current_role_name();
begin
  if current_setting('app.bora_la_system_write', true) = 'true' then return new; end if;
  if current_setting('app.passenger_portal_write', true) = 'true' then
    if (to_jsonb(new) - array['passenger_access_status','passenger_access_submitted_at','listagem_status','listagem_enviada_em','listagem_parecer_comentario']) is distinct from
       (to_jsonb(old) - array['passenger_access_status','passenger_access_submitted_at','listagem_status','listagem_enviada_em','listagem_parecer_comentario']) then raise exception 'Alteração inválida pelo portal de passageiros.'; end if;
    return new;
  end if;
  if role_name = 'admin' then return new; end if;
  if role_name = 'operacional' and (public.has_access_permission('agenda', true) or public.has_access_permission('validacoes', true)) then return new; end if;
  if role_name = 'escola' then
    if new.school_id is distinct from public.current_school_id() then
      raise exception 'A escola só pode alterar viagens da própria unidade.';
    end if;
    if (to_jsonb(new) - array['situacao','cancel_reason','cancelled_by','cancelled_at','doc_filename','doc_drive_file_id','doc_drive_url','doc_uploaded_at','doc_status','doc_parecer_comentario','listagem_status','listagem_enviada_em','atf_lista_enviada_em']) is distinct from
       (to_jsonb(old) - array['situacao','cancel_reason','cancelled_by','cancelled_at','doc_filename','doc_drive_file_id','doc_drive_url','doc_uploaded_at','doc_status','doc_parecer_comentario','listagem_status','listagem_enviada_em','atf_lista_enviada_em']) then raise exception 'A escola só pode cancelar a própria viagem, enviar seu documento ou enviar sua listagem.'; end if;
    if new.cancelled_by is distinct from old.cancelled_by and new.cancelled_by <> auth.uid() then raise exception 'Cancelamento inválido.'; end if;
    if new.doc_status is distinct from old.doc_status and new.doc_status <> 'em_analise' then raise exception 'A escola só pode enviar documento para análise.'; end if;
    if new.listagem_status is distinct from old.listagem_status and not (new.listagem_status = 'enviada' and old.listagem_status in ('nao_enviada','rejeitada')) then raise exception 'A escola só pode enviar ou reenviar sua listagem.'; end if;
    return new;
  end if;
  if role_name = 'pedagogia' then
    if (to_jsonb(new) - array['status','rejection_reason','pedagogy_approved_by','pedagogy_approved_at','atf_status','situacao','doc_status','doc_parecer_comentario','doc_parecer_por','doc_parecer_em','setor_pedagogico_atual','validation_sector_id']) is distinct from
       (to_jsonb(old) - array['status','rejection_reason','pedagogy_approved_by','pedagogy_approved_at','atf_status','situacao','doc_status','doc_parecer_comentario','doc_parecer_por','doc_parecer_em','setor_pedagogico_atual','validation_sector_id']) then raise exception 'A Pedagogia só pode registrar o parecer pedagógico.'; end if;
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
