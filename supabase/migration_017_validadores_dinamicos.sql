-- Bora Lá | Cadastro dinâmico de público-alvo, setores e validadores.
-- Execute após as migrations já aplicadas. As colunas antigas continuam para
-- compatibilidade com solicitações históricas.

create table if not exists validation_sectors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists validation_targets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_sector_id uuid references validation_sectors(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists validator_sector_assignments (
  profile_id uuid not null references profiles(id) on delete cascade,
  sector_id uuid not null references validation_sectors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, sector_id)
);

alter table excursions add column if not exists validation_target_id uuid references validation_targets(id) on delete set null;
alter table excursions add column if not exists validation_sector_id uuid references validation_sectors(id) on delete set null;
create index if not exists idx_excursions_validation_sector on excursions(validation_sector_id);

insert into validation_sectors (name) values
  ('Educação Infantil'), ('Ensino Fundamental'), ('Étnico-Racial'),
  ('Educação Inclusiva'), ('Tempo Integral'), ('Administração')
on conflict (name) do nothing;

insert into validation_targets (name, default_sector_id) values
  ('Educação Infantil', (select id from validation_sectors where name = 'Educação Infantil')),
  ('Ensino Fundamental - Anos Iniciais', (select id from validation_sectors where name = 'Ensino Fundamental')),
  ('Ensino Fundamental - Anos Finais', (select id from validation_sectors where name = 'Ensino Fundamental')),
  ('Ensino Médio', (select id from validation_sectors where name = 'Administração')),
  ('EJA - Adulto', (select id from validation_sectors where name = 'Administração'))
on conflict (name) do nothing;

update excursions e set validation_target_id = t.id
from validation_targets t
where e.validation_target_id is null and t.name = case e.publico_alvo
  when 'educacao_infantil' then 'Educação Infantil'
  when 'fundamental_iniciais' then 'Ensino Fundamental - Anos Iniciais'
  when 'fundamental_finais' then 'Ensino Fundamental - Anos Finais'
  when 'ensino_medio' then 'Ensino Médio'
  when 'eja_adulto' then 'EJA - Adulto' end;

update excursions e set validation_sector_id = s.id
from validation_sectors s
where e.validation_sector_id is null and s.name = case e.setor_pedagogico_atual
  when 'educacao_infantil' then 'Educação Infantil'
  when 'ensino_fundamental' then 'Ensino Fundamental'
  when 'etnico_racial' then 'Étnico-Racial'
  when 'educacao_inclusiva' then 'Educação Inclusiva'
  when 'tempo_integral' then 'Tempo Integral'
  else 'Administração' end;

alter table validation_sectors enable row level security;
alter table validation_targets enable row level security;
alter table validator_sector_assignments enable row level security;

drop policy if exists validation_sectors_select on validation_sectors;
create policy validation_sectors_select on validation_sectors for select using (auth.uid() is not null);
drop policy if exists validation_targets_select on validation_targets;
create policy validation_targets_select on validation_targets for select using (auth.uid() is not null);
drop policy if exists validator_sector_assignments_select on validator_sector_assignments;
create policy validator_sector_assignments_select on validator_sector_assignments for select using (auth.uid() is not null);

drop policy if exists validation_sectors_admin_write on validation_sectors;
create policy validation_sectors_admin_write on validation_sectors for all using (public.current_role_name() = 'admin') with check (public.current_role_name() = 'admin');
drop policy if exists validation_targets_admin_write on validation_targets;
create policy validation_targets_admin_write on validation_targets for all using (public.current_role_name() = 'admin') with check (public.current_role_name() = 'admin');
drop policy if exists validator_sector_assignments_admin_write on validator_sector_assignments;
create policy validator_sector_assignments_admin_write on validator_sector_assignments for all using (public.current_role_name() = 'admin') with check (public.current_role_name() = 'admin');

-- Inclui o novo setor dinâmico entre os únicos campos que a Pedagogia pode encaminhar.
create or replace function public.guard_excursion_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare role_name text := public.current_role_name();
begin
  if current_setting('app.passenger_portal_write', true) = 'true' then
    if (to_jsonb(new) - array['passenger_access_status','passenger_access_submitted_at','listagem_status','listagem_enviada_em','listagem_parecer_comentario']) is distinct from
       (to_jsonb(old) - array['passenger_access_status','passenger_access_submitted_at','listagem_status','listagem_enviada_em','listagem_parecer_comentario']) then raise exception 'Alteração inválida pelo portal de passageiros.'; end if;
    return new;
  end if;
  if role_name = 'admin' then return new; end if;
  if role_name = 'escola' then
    if (to_jsonb(new) - array['situacao','cancel_reason','cancelled_by','cancelled_at','doc_filename','doc_drive_file_id','doc_drive_url','doc_uploaded_at','doc_status','doc_parecer_comentario']) is distinct from
       (to_jsonb(old) - array['situacao','cancel_reason','cancelled_by','cancelled_at','doc_filename','doc_drive_file_id','doc_drive_url','doc_uploaded_at','doc_status','doc_parecer_comentario']) then raise exception 'A escola só pode cancelar a própria viagem ou enviar seu documento.'; end if;
    if new.cancelled_by is distinct from old.cancelled_by and new.cancelled_by <> auth.uid() then raise exception 'Cancelamento inválido.'; end if;
    if new.doc_status is distinct from old.doc_status and new.doc_status <> 'em_analise' then raise exception 'A escola só pode enviar documento para análise.'; end if;
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
end;
$$;
