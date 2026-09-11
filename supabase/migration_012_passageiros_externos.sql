-- Bora Lá - cadastro externo de passageiros por link seguro
alter table excursions add column if not exists passenger_access_token text unique;
alter table excursions add column if not exists passenger_access_status text not null default 'nao_liberado';
alter table excursions drop constraint if exists excursions_passenger_access_status_check;
alter table excursions add constraint excursions_passenger_access_status_check check (passenger_access_status in ('nao_liberado','aberto','enviado','bloqueado'));
alter table excursions add column if not exists passenger_access_submitted_at timestamptz;
update excursions set passenger_access_status = 'nao_liberado' where passenger_access_status is null;
alter table excursion_passengers add column if not exists tipo_documento text not null default 'cpf';

-- RPC pública: o token é o segredo do link. Não expõe listagem de outras viagens.
create or replace function public.get_passenger_portal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r excursions%rowtype;
begin
  select * into r from excursions where passenger_access_token = p_token and passenger_access_token is not null limit 1;
  if not found then raise exception 'Link inválido ou expirado.'; end if;
  return jsonb_build_object(
    'id', r.id, 'destination', r.destination, 'destination_address', r.destination_address,
    'city', r.city, 'trip_date', r.trip_date, 'departure_time', r.departure_time,
    'return_time', r.return_time, 'origin_name', r.origin_name, 'origin_address', r.origin_address,
    'origin_city', r.origin_city, 'total_passengers', coalesce(r.students_count,0)+coalesce(r.companions_count,0)+coalesce(r.pca_count,0)+coalesce(r.apoio_count,0),
    'status', r.status, 'access_status', r.passenger_access_status,
    'submitted_at', r.passenger_access_submitted_at,
    'requires_full_list', (lower(coalesce(r.city,'')) <> 'nova lima' or lower(coalesce(r.origin_city,'')) <> 'nova lima')
  );
end; $$;

create or replace function public.get_passenger_portal_rows(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare eid uuid;
begin
  select id into eid from excursions where passenger_access_token = p_token and passenger_access_token is not null limit 1;
  if eid is null then raise exception 'Link inválido ou expirado.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('nome',nome,'tipo_documento',tipo_documento,'documento',documento) order by created_at) from excursion_passengers where excursion_id=eid), '[]'::jsonb);
end; $$;

create or replace function public.save_passenger_portal(p_token text, p_passengers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r excursions%rowtype; qtd integer; precisa boolean;
begin
  select * into r from excursions where passenger_access_token = p_token and passenger_access_token is not null for update;
  if not found then raise exception 'Link inválido ou expirado.'; end if;
  if r.passenger_access_status in ('enviado','bloqueado') then raise exception 'O cadastro já foi enviado e está bloqueado para edição.'; end if;
  if r.status not in ('approved','in_transit','completed') then raise exception 'O cadastro só está disponível após a aprovação da viagem.'; end if;
  qtd := jsonb_array_length(coalesce(p_passengers,'[]'::jsonb));
  precisa := lower(coalesce(r.city,'')) <> 'nova lima' or lower(coalesce(r.origin_city,'')) <> 'nova lima';
  if qtd <> (coalesce(r.students_count,0)+coalesce(r.companions_count,0)+coalesce(r.pca_count,0)+coalesce(r.apoio_count,0)) then raise exception 'A quantidade de passageiros deve ser exatamente a quantidade da solicitação.'; end if;
  if precisa and exists (select 1 from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) x where nullif(trim(x->>'nome'),'') is null or nullif(trim(x->>'documento'),'') is null or coalesce(x->>'tipo_documento','') not in ('cpf','rg','certidao_nascimento')) then raise exception 'Nome, tipo e número do documento são obrigatórios para todos os passageiros.'; end if;
  delete from excursion_passengers where excursion_id=r.id;
  insert into excursion_passengers(excursion_id,nome,tipo_documento,documento)
    select r.id, trim(x->>'nome'), coalesce(x->>'tipo_documento','cpf'), nullif(trim(x->>'documento'),'') from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) x;
  update excursions set passenger_access_status='enviado', passenger_access_submitted_at=now() where id=r.id;
  return jsonb_build_object('ok',true,'count',qtd);
end; $$;

revoke all on function public.get_passenger_portal(text) from public;
revoke all on function public.get_passenger_portal_rows(text) from public;
revoke all on function public.save_passenger_portal(text,jsonb) from public;
grant execute on function public.get_passenger_portal(text) to anon, authenticated;
grant execute on function public.get_passenger_portal_rows(text) to anon, authenticated;
grant execute on function public.save_passenger_portal(text,jsonb) to anon, authenticated;

alter table excursion_passengers drop constraint if exists excursion_passengers_tipo_documento_check;
alter table excursion_passengers add constraint excursion_passengers_tipo_documento_check check (tipo_documento in ('cpf','rg','certidao_nascimento'));
