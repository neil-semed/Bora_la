-- Bora Lá - fluxo de notificações e controle do cadastro de passageiros
alter table excursions add column if not exists passenger_access_notified_at timestamptz;
alter table excursions add column if not exists cooperativa_email_sent_at timestamptz;
alter table excursions add column if not exists cooperativa_email_last_error text;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  excursion_id uuid references excursions(id) on delete cascade,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;
drop policy if exists notifications_select_own on notifications;
create policy notifications_select_own on notifications for select
  using (user_id = auth.uid());
drop policy if exists notifications_update_own on notifications;
create policy notifications_update_own on notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
drop policy if exists notifications_insert_admin on notifications;
create policy notifications_insert_admin on notifications for insert
  with check (public.current_role_name() = 'admin' or user_id = auth.uid());

create index if not exists notifications_user_created_idx on notifications(user_id, created_at desc);

-- O portal público usa o token como segredo do link e não expõe dados de outras viagens.
-- Retorna os veículos/motoristas atribuídos para que a entidade possa distribuir a lista.
create or replace function public.get_passenger_portal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r excursions%rowtype; veh jsonb;
begin
  select * into r from excursions where passenger_access_token = p_token and passenger_access_token is not null limit 1;
  if not found then raise exception 'Link inválido ou expirado.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'driver_id', ed.driver_id,
    'driver_name', d.name,
    'plate', v.plate,
    'capacity', v.capacity
  ) order by d.name), '[]'::jsonb)
  into veh
  from excursion_drivers ed
  join drivers d on d.id = ed.driver_id
  left join vehicles v on v.id = d.vehicle_id
  where ed.excursion_id = r.id;

  return jsonb_build_object(
    'id', r.id, 'destination', r.destination, 'destination_address', r.destination_address,
    'city', r.city, 'trip_date', r.trip_date, 'departure_time', r.departure_time,
    'return_time', r.return_time, 'origin_name', r.origin_name, 'origin_address', r.origin_address,
    'origin_city', r.origin_city,
    'total_passengers', coalesce(r.students_count,0)+coalesce(r.companions_count,0)+coalesce(r.pca_count,0)+coalesce(r.apoio_count,0),
    'status', r.status, 'access_status', r.passenger_access_status,
    'submitted_at', r.passenger_access_submitted_at,
    'requires_full_list', (lower(coalesce(r.city,'')) <> 'nova lima' or lower(coalesce(r.origin_city,'')) <> 'nova lima'),
    'vehicles', veh
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'nome',nome,'tipo_documento',tipo_documento,'documento',documento,'driver_id',driver_id
    ) order by created_at)
    from excursion_passengers where excursion_id=eid
  ), '[]'::jsonb);
end; $$;

create or replace function public.save_passenger_portal(p_token text, p_passengers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r excursions%rowtype; qtd integer; capacidade integer;
begin
  select * into r from excursions where passenger_access_token = p_token and passenger_access_token is not null for update;
  if not found then raise exception 'Link inválido ou expirado.'; end if;
  if r.passenger_access_status in ('enviado','bloqueado') then raise exception 'O cadastro já foi enviado e está bloqueado para edição.'; end if;
  if r.status not in ('approved','in_transit','completed') then raise exception 'O cadastro só está disponível após a aprovação da viagem.'; end if;

  qtd := jsonb_array_length(coalesce(p_passengers,'[]'::jsonb));

  select coalesce(sum(v.capacity),0) into capacidade
  from excursion_drivers ed
  join drivers d on d.id=ed.driver_id
  left join vehicles v on v.id=d.vehicle_id
  where ed.excursion_id=r.id;

  if qtd > capacidade then raise exception 'A quantidade de passageiros não pode ultrapassar a capacidade dos veículos atribuídos (% lugares).', capacidade; end if;
  if qtd = 0 then raise exception 'Informe pelo menos um passageiro.'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) x
    where nullif(trim(x->>'nome'),'') is null
       or nullif(trim(x->>'documento'),'') is null
       or coalesce(x->>'tipo_documento','') not in ('cpf','rg','certidao_nascimento')
       or nullif(trim(x->>'driver_id'),'') is null
  ) then raise exception 'Cada passageiro precisa de nome completo, tipo, número do documento e veículo.'; end if;

  if exists (
    select 1 from (
      select (x->>'driver_id')::uuid as driver_id, count(*) as qtd
      from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) x
      group by (x->>'driver_id')
    ) q
    left join drivers d on d.id=q.driver_id
    left join vehicles v on v.id=d.vehicle_id
    where v.id is null or q.qtd > coalesce(v.capacity,0)
  ) then raise exception 'A quantidade de passageiros de um veículo ultrapassa sua capacidade.'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) x
    where (x->>'driver_id')::uuid not in (select driver_id from excursion_drivers where excursion_id=r.id)
  ) then raise exception 'Veículo não atribuído a esta viagem.'; end if;

  delete from excursion_passengers where excursion_id=r.id;
  insert into excursion_passengers(excursion_id,nome,tipo_documento,documento,driver_id)
    select r.id, trim(x->>'nome'), x->>'tipo_documento', trim(x->>'documento'), (x->>'driver_id')::uuid
    from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) x;

  update excursions set passenger_access_status='enviado', passenger_access_submitted_at=now(), listagem_status='enviada', listagem_enviada_em=now(), listagem_parecer_comentario=null where id=r.id;

  insert into notifications(user_id, excursion_id, title, message)
    select p.id, r.id, 'Listagem de passageiros para conferência',
           'A entidade/comitiva enviou a listagem de passageiros. Confira e aprove ou devolva para correção.'
    from profiles p where p.role='admin' and p.active=true;

  return jsonb_build_object('ok',true,'count',qtd);
end; $$;

revoke all on function public.get_passenger_portal(text) from public;
revoke all on function public.get_passenger_portal_rows(text) from public;
revoke all on function public.save_passenger_portal(text,jsonb) from public;
grant execute on function public.get_passenger_portal(text) to anon, authenticated;
grant execute on function public.get_passenger_portal_rows(text) to anon, authenticated;
grant execute on function public.save_passenger_portal(text,jsonb) to anon, authenticated;
