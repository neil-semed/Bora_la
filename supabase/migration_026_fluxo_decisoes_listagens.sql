-- Bora Lá | Separação entre decisão administrativa, validação pedagógica e listas.
-- Execute este arquivo inteiro no SQL Editor depois da migration_025.
-- É seguro executá-lo mais de uma vez.

alter table public.excursions
  add column if not exists admin_decision text not null default 'pendente',
  add column if not exists admin_decision_by uuid references public.profiles(id) on delete set null,
  add column if not exists admin_decision_at timestamptz,
  add column if not exists admin_decision_reason text,
  add column if not exists reactivated_at timestamptz,
  add column if not exists reactivated_by uuid references public.profiles(id) on delete set null,
  add column if not exists pcd_list_status text not null default 'nao_se_aplica',
  add column if not exists pcd_list_reason text,
  add column if not exists pcd_list_reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists pcd_list_reviewed_at timestamptz,
  add column if not exists pcd_cooperativa_response text,
  add column if not exists pcd_cooperativa_response_at timestamptz,
  add column if not exists atf_cooperativa_response text,
  add column if not exists atf_cooperativa_response_at timestamptz;

-- Mantém dados legados coerentes com os novos campos, sem alterar decisões já gravadas.
update public.excursions
set admin_decision = case
  when status = 'rejected' or situacao = 'reprovada' then 'reprovada'
  when status in ('approved','in_transit','completed') or situacao in ('aprovada','confirmada','envio_coop','aguarda_atf','sem_listagem') then 'aprovada'
  else 'pendente'
end
where admin_decision is null or admin_decision = 'pendente';

alter table public.excursions drop constraint if exists excursions_admin_decision_check;
alter table public.excursions add constraint excursions_admin_decision_check
  check (admin_decision in ('pendente','aprovada','reprovada'));
alter table public.excursions drop constraint if exists excursions_pcd_list_status_check;
alter table public.excursions add constraint excursions_pcd_list_status_check
  check (pcd_list_status in ('nao_se_aplica','pendente','enviada','aprovada','rejeitada','dispensada'));

create index if not exists excursions_admin_decision_idx on public.excursions(admin_decision);
create index if not exists excursions_pcd_list_status_idx on public.excursions(pcd_list_status);

create or replace function public.sync_cooperativa_response()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.atf_emitida_em is not null and (old.atf_emitida_em is distinct from new.atf_emitida_em) then
    new.atf_cooperativa_response := 'emitida'; new.atf_cooperativa_response_at := new.atf_emitida_em;
  end if;
  if new.pcd_cooperativa_confirmado_em is not null and (old.pcd_cooperativa_confirmado_em is distinct from new.pcd_cooperativa_confirmado_em) then
    new.pcd_cooperativa_response := 'veiculo_ok'; new.pcd_cooperativa_response_at := new.pcd_cooperativa_confirmado_em;
  end if;
  return new;
end; $$;
drop trigger if exists trg_sync_cooperativa_response on public.excursions;
create trigger trg_sync_cooperativa_response before update on public.excursions
for each row execute function public.sync_cooperativa_response();

-- Endereço global que sempre recebe cópia dos e-mails enviados às cooperativas.
insert into public.app_settings(key, value)
values ('email_copia_setor', 'excursao.semed@pnl.mg.gov.br')
on conflict (key) do nothing;

-- Respostas da cooperativa são informativas: nunca cancelam ou reprovam a excursão.
create or replace function public.agent_reject_atf(p_excursion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode responder à ATF.'; end if;
  select * into v from public.excursions where id=p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if not exists (select 1 from public.excursion_drivers ed join public.drivers d on d.id=ed.driver_id where ed.excursion_id=v.id and d.cooperativa_id=public.current_cooperativa_id()) then raise exception 'Esta viagem não pertence à sua cooperativa.'; end if;
  update public.excursions set atf_cooperativa_response='rejeitada', atf_cooperativa_response_at=now() where id=v.id;
  insert into public.notifications(user_id,excursion_id,title,message)
  select p.id,v.id,'Cooperativa recusou ATF','A cooperativa informou que não emitirá a ATF. Entre em contato com o Administrador SEMED.' from public.profiles p where p.active and p.role='admin';
end; $$;

create or replace function public.agent_reject_pcd(p_excursion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v excursions%rowtype; begin
  if public.current_role_name() <> 'agente_externo' then raise exception 'Apenas o agente externo pode responder ao PCD.'; end if;
  select * into v from public.excursions where id=p_excursion_id for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  if not exists (select 1 from public.excursion_drivers ed join public.drivers d on d.id=ed.driver_id where ed.excursion_id=v.id and d.cooperativa_id=public.current_cooperativa_id()) then raise exception 'Esta viagem não pertence à sua cooperativa.'; end if;
  update public.excursions set pcd_cooperativa_response='negada', pcd_cooperativa_response_at=now() where id=v.id;
  insert into public.notifications(user_id,excursion_id,title,message)
  select p.id,v.id,'Transporte PCD negado','A cooperativa informou que não atenderá o transporte PCD desta solicitação.' from public.profiles p where p.active and (p.role in ('admin','pedagogia') or (p.role='escola' and p.school_id=v.school_id));
end; $$;

revoke all on function public.agent_reject_atf(uuid) from public;
revoke all on function public.agent_reject_pcd(uuid) from public;
grant execute on function public.agent_reject_atf(uuid) to authenticated;
grant execute on function public.agent_reject_pcd(uuid) to authenticated;

-- A unidade pode reenviar somente a sua própria lista PCD devolvida pelo Admin.
-- O RPC substitui as linhas em uma única transação e registra a lista novamente como enviada.
create or replace function public.school_resubmit_pcd_list(p_excursion_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v excursions%rowtype;
  r jsonb;
begin
  if public.current_role_name() <> 'escola' then raise exception 'Apenas a unidade solicitante pode reenviar a lista PCD.'; end if;
  select * into v from excursions where id = p_excursion_id for update;
  if not found or v.school_id is distinct from public.current_school_id() then raise exception 'Solicitação não encontrada para esta unidade.'; end if;
  if v.pcd_list_status <> 'rejeitada' then raise exception 'Esta lista PCD não está aguardando correção.'; end if;
  if coalesce(jsonb_typeof(p_rows),'') <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Informe ao menos um estudante PCD.'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if coalesce(trim(r->>'nome_aluno'),'') = '' or coalesce(trim(r->>'documento_aluno'),'') = '' or coalesce(trim(r->>'nome_apoio'),'') = '' or coalesce(trim(r->>'documento_apoio'),'') = '' then
      raise exception 'Nome e documento do estudante PCD e de seu apoio são obrigatórios.';
    end if;
  end loop;
  delete from excursion_pcd_students where excursion_id = p_excursion_id;
  insert into excursion_pcd_students(excursion_id,nome_aluno,documento_aluno,cadeirante,nome_apoio,documento_apoio)
  select p_excursion_id, trim(value->>'nome_aluno'), trim(value->>'documento_aluno'), coalesce((value->>'cadeirante')::boolean,false), trim(value->>'nome_apoio'), trim(value->>'documento_apoio')
  from jsonb_array_elements(p_rows);
  update excursions set pca_count=jsonb_array_length(p_rows), apoio_count=jsonb_array_length(p_rows), pcd_list_status='enviada', pcd_list_reason=null, pcd_lista_enviada_em=now() where id=p_excursion_id;
  insert into notifications(user_id,excursion_id,title,message)
  select p.id,p_excursion_id,'Lista PCD reenviada','A unidade reenviou a lista PCD para conferência.' from profiles p where p.active and p.role='admin';
end; $$;
revoke all on function public.school_resubmit_pcd_list(uuid,jsonb) from public;
grant execute on function public.school_resubmit_pcd_list(uuid,jsonb) to authenticated;
