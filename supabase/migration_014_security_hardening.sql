-- Segurança: privilégios, alterações de viagens e links públicos de passageiros.
-- Execute esta migration UMA vez, depois da migration_013.

-- Perfis: ninguém pode editar seu próprio papel, unidade, motorista ou estado.
drop policy if exists "profiles_update_own_or_admin" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles for update
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

drop policy if exists "profiles_insert_admin" on public.profiles;
drop policy if exists "profiles_insert_admin_only" on public.profiles;
create policy "profiles_insert_admin_only" on public.profiles for insert
  with check (public.current_role_name() = 'admin');

-- Cria com segurança o perfil padrão no primeiro login de uma conta existente.
-- A função não recebe nem aceita papel, unidade ou motorista do navegador.
create or replace function public.ensure_own_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare result public.profiles;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  insert into public.profiles (id, email, full_name, role)
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'email', auth.uid()::text),
    coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1)),
    'escola'
  ) on conflict (id) do nothing;
  select * into result from public.profiles where id = auth.uid();
  return result;
end;
$$;
revoke all on function public.ensure_own_profile() from public;
grant execute on function public.ensure_own_profile() to authenticated;

-- As políticas de linha não restringem colunas. Este gatilho garante que os
-- perfis operacionais só alterem os campos do seu fluxo, mesmo via REST direto.
create or replace function public.guard_excursion_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare role_name text := public.current_role_name();
begin
  -- A única escrita anônima é feita pela função security-definer do portal,
  -- que marca este contexto temporário antes de bloquear a listagem enviada.
  if current_setting('app.passenger_portal_write', true) = 'true' then
    if (to_jsonb(new) - array['passenger_access_status','passenger_access_submitted_at',
        'listagem_status','listagem_enviada_em','listagem_parecer_comentario'])
       is distinct from
       (to_jsonb(old) - array['passenger_access_status','passenger_access_submitted_at',
        'listagem_status','listagem_enviada_em','listagem_parecer_comentario']) then
      raise exception 'Alteração inválida pelo portal de passageiros.';
    end if;
    return new;
  end if;
  if role_name = 'admin' then return new; end if;

  if role_name = 'escola' then
    if (to_jsonb(new) - array['situacao','cancel_reason','cancelled_by','cancelled_at',
        'doc_filename','doc_drive_file_id','doc_drive_url','doc_uploaded_at','doc_status','doc_parecer_comentario'])
       is distinct from
       (to_jsonb(old) - array['situacao','cancel_reason','cancelled_by','cancelled_at',
        'doc_filename','doc_drive_file_id','doc_drive_url','doc_uploaded_at','doc_status','doc_parecer_comentario']) then
      raise exception 'A escola só pode cancelar a própria viagem ou enviar seu documento.';
    end if;
    if new.cancelled_by is distinct from old.cancelled_by and new.cancelled_by <> auth.uid() then
      raise exception 'Cancelamento inválido.';
    end if;
    if new.doc_status is distinct from old.doc_status and new.doc_status <> 'em_analise' then
      raise exception 'A escola só pode enviar documento para análise.';
    end if;
    return new;
  end if;

  if role_name = 'pedagogia' then
    if (to_jsonb(new) - array['status','rejection_reason','pedagogy_approved_by','pedagogy_approved_at',
        'atf_status','situacao','doc_status','doc_parecer_comentario','doc_parecer_por','doc_parecer_em',
        'setor_pedagogico_atual'])
       is distinct from
       (to_jsonb(old) - array['status','rejection_reason','pedagogy_approved_by','pedagogy_approved_at',
        'atf_status','situacao','doc_status','doc_parecer_comentario','doc_parecer_por','doc_parecer_em',
        'setor_pedagogico_atual']) then
      raise exception 'A Pedagogia só pode registrar o parecer pedagógico.';
    end if;
    if (new.pedagogy_approved_by is distinct from old.pedagogy_approved_by and new.pedagogy_approved_by <> auth.uid())
       or (new.doc_parecer_por is distinct from old.doc_parecer_por and new.doc_parecer_por <> auth.uid()) then
      raise exception 'Autor do parecer inválido.';
    end if;
    return new;
  end if;

  if role_name = 'motorista' then
    if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception 'O motorista só pode alterar o andamento da viagem.';
    end if;
    if not ((old.status = 'approved' and new.status = 'in_transit')
            or (old.status = 'in_transit' and new.status = 'completed')) then
      raise exception 'Transição de viagem inválida.';
    end if;
    return new;
  end if;

  raise exception 'Perfil sem permissão para alterar viagens.';
end;
$$;
drop trigger if exists trg_guard_excursion_update on public.excursions;
create trigger trg_guard_excursion_update
  before update on public.excursions
  for each row execute function public.guard_excursion_update();

-- O link de passageiros é bearer-token: expira em 7 dias e não revela a
-- listagem depois do envio. Links abertos antigos permanecem ativos por 7 dias.
alter table public.excursions add column if not exists passenger_access_expires_at timestamptz;
update public.excursions
  set passenger_access_expires_at = now() + interval '7 days'
  where passenger_access_status = 'aberto' and passenger_access_expires_at is null;

create or replace function public.get_passenger_portal(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r excursions%rowtype; veh jsonb;
begin
  select * into r from excursions
   where passenger_access_token = p_token and passenger_access_token is not null
     and passenger_access_status = 'aberto' and passenger_access_expires_at > now()
   limit 1;
  if not found then raise exception 'Link inválido, expirado ou já encerrado.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('driver_id',ed.driver_id,'driver_name',d.name,'plate',v.plate,'capacity',v.capacity) order by d.name),'[]'::jsonb)
    into veh from excursion_drivers ed join drivers d on d.id=ed.driver_id left join vehicles v on v.id=d.vehicle_id where ed.excursion_id=r.id;
  return jsonb_build_object('id',r.id,'destination',r.destination,'destination_address',r.destination_address,'city',r.city,'trip_date',r.trip_date,'departure_time',r.departure_time,'return_time',r.return_time,'origin_name',r.origin_name,'origin_address',r.origin_address,'origin_city',r.origin_city,'total_passengers',coalesce(r.students_count,0)+coalesce(r.companions_count,0)+coalesce(r.pca_count,0)+coalesce(r.apoio_count,0),'status',r.status,'access_status',r.passenger_access_status,'expires_at',r.passenger_access_expires_at,'requires_full_list',(lower(coalesce(r.city,'')) <> 'nova lima' or lower(coalesce(r.origin_city,'')) <> 'nova lima'),'vehicles',veh);
end; $$;

create or replace function public.get_passenger_portal_rows(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  select id into eid from excursions where passenger_access_token=p_token and passenger_access_status='aberto' and passenger_access_expires_at>now() limit 1;
  if eid is null then raise exception 'Link inválido, expirado ou já encerrado.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('nome',nome,'tipo_documento',tipo_documento,'documento',documento,'driver_id',driver_id) order by created_at) from excursion_passengers where excursion_id=eid),'[]'::jsonb);
end; $$;

create or replace function public.save_passenger_portal(p_token text, p_passengers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r excursions%rowtype; qtd integer; capacidade integer;
begin
  select * into r from excursions where passenger_access_token=p_token and passenger_access_status='aberto' and passenger_access_expires_at>now() for update;
  if not found then raise exception 'Link inválido, expirado ou já encerrado.'; end if;
  if r.status not in ('approved','in_transit','completed') then raise exception 'O cadastro só está disponível após a aprovação da viagem.'; end if;
  qtd := jsonb_array_length(coalesce(p_passengers,'[]'::jsonb));
  select coalesce(sum(v.capacity),0) into capacidade from excursion_drivers ed join drivers d on d.id=ed.driver_id left join vehicles v on v.id=d.vehicle_id where ed.excursion_id=r.id;
  if qtd > capacidade then raise exception 'A quantidade de passageiros não pode ultrapassar a capacidade dos veículos atribuídos (% lugares).', capacidade; end if;
  if qtd = 0 then raise exception 'Informe pelo menos um passageiro.'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) x where nullif(trim(x->>'nome'),'') is null or nullif(trim(x->>'documento'),'') is null or coalesce(x->>'tipo_documento','') not in ('cpf','rg','certidao_nascimento') or nullif(trim(x->>'driver_id'),'') is null) then raise exception 'Cada passageiro precisa de nome completo, tipo, número do documento e veículo.'; end if;
  if exists (select 1 from (select (x->>'driver_id')::uuid driver_id,count(*) qtd from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) x group by (x->>'driver_id')) q left join drivers d on d.id=q.driver_id left join vehicles v on v.id=d.vehicle_id where v.id is null or q.qtd>coalesce(v.capacity,0)) then raise exception 'A quantidade de passageiros de um veículo ultrapassa sua capacidade.'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) x where (x->>'driver_id')::uuid not in (select driver_id from excursion_drivers where excursion_id=r.id)) then raise exception 'Veículo não atribuído a esta viagem.'; end if;
  delete from excursion_passengers where excursion_id=r.id;
  insert into excursion_passengers(excursion_id,nome,tipo_documento,documento,driver_id) select r.id,trim(x->>'nome'),x->>'tipo_documento',trim(x->>'documento'),(x->>'driver_id')::uuid from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) x;
  perform set_config('app.passenger_portal_write','true',true);
  update excursions set passenger_access_status='enviado',passenger_access_submitted_at=now(),listagem_status='enviada',listagem_enviada_em=now(),listagem_parecer_comentario=null where id=r.id;
  insert into notifications(user_id,excursion_id,title,message) select p.id,r.id,'Listagem de passageiros para conferência','A entidade/comitiva enviou a listagem de passageiros. Confira e aprove ou devolva para correção.' from profiles p where p.role='admin' and p.active=true;
  return jsonb_build_object('ok',true,'count',qtd);
end; $$;

revoke all on function public.get_passenger_portal(text) from public;
revoke all on function public.get_passenger_portal_rows(text) from public;
revoke all on function public.save_passenger_portal(text,jsonb) from public;
grant execute on function public.get_passenger_portal(text) to anon, authenticated;
grant execute on function public.get_passenger_portal_rows(text) to anon, authenticated;
grant execute on function public.save_passenger_portal(text,jsonb) to anon, authenticated;
