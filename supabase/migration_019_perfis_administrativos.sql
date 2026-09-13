-- Bora Lá | Perfis administrativos configuráveis.
-- Escola, Pedagogia, Motorista e Admin continuam com suas políticas próprias.

create table if not exists public.access_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.access_profile_permissions (
  access_profile_id uuid not null references public.access_profiles(id) on delete cascade,
  screen_key text not null check (screen_key in ('dashboard', 'agenda', 'solicitacao', 'relatorios', 'validacoes', 'km', 'veiculos', 'motoristas')),
  can_view boolean not null default false,
  can_edit boolean not null default false,
  primary key (access_profile_id, screen_key),
  constraint access_profile_permissions_edit_requires_view check (not can_edit or can_view)
);
-- A tabela pode já existir de uma execução anterior desta migration; atualiza o
-- catálogo permitido sem apagar nenhuma permissão já criada.
alter table public.access_profile_permissions drop constraint if exists access_profile_permissions_screen_key_check;
alter table public.access_profile_permissions add constraint access_profile_permissions_screen_key_check
  check (screen_key in ('dashboard', 'agenda', 'solicitacao', 'relatorios', 'validacoes', 'km', 'veiculos', 'motoristas'));

alter table public.profiles add column if not exists access_profile_id uuid references public.access_profiles(id) on delete set null;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'escola', 'pedagogia', 'motorista', 'operacional'));

create or replace function public.has_access_permission(p_screen_key text, p_requires_edit boolean default false)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.profiles u
    join public.access_profiles ap on ap.id = u.access_profile_id and ap.active
    join public.access_profile_permissions pp on pp.access_profile_id = ap.id
    where u.id = auth.uid()
      and u.role = 'operacional'
      and pp.screen_key = p_screen_key
      and pp.can_view
      and (not p_requires_edit or pp.can_edit)
  );
$$;

alter table public.access_profiles enable row level security;
alter table public.access_profile_permissions enable row level security;

drop policy if exists access_profiles_select_authenticated on public.access_profiles;
drop policy if exists access_profile_permissions_select_authenticated on public.access_profile_permissions;
drop policy if exists access_profiles_admin_write on public.access_profiles;
drop policy if exists access_profile_permissions_admin_write on public.access_profile_permissions;
create policy access_profiles_select_authenticated on public.access_profiles for select using (auth.role() = 'authenticated');
create policy access_profile_permissions_select_authenticated on public.access_profile_permissions for select using (auth.role() = 'authenticated');
create policy access_profiles_admin_write on public.access_profiles for all using (public.current_role_name() = 'admin') with check (public.current_role_name() = 'admin');
create policy access_profile_permissions_admin_write on public.access_profile_permissions for all using (public.current_role_name() = 'admin') with check (public.current_role_name() = 'admin');

-- Perfis operacionais só veem a agenda completa quando alguma tela administrativa
-- que a utiliza foi liberada. A criação e a edição são separadas por permissão.
drop policy if exists excursions_operacional_select on public.excursions;
drop policy if exists excursions_operacional_insert on public.excursions;
drop policy if exists excursions_operacional_update on public.excursions;
drop policy if exists excursion_drivers_operacional_write on public.excursion_drivers;
drop policy if exists doc_history_operacional_select on public.excursion_doc_history;
drop policy if exists doc_history_operacional_insert on public.excursion_doc_history;
drop policy if exists km_logs_operacional_select on public.driver_km_logs;
drop policy if exists km_logs_operacional_write on public.driver_km_logs;
drop policy if exists vehicles_operacional_write on public.vehicles;
drop policy if exists drivers_operacional_write on public.drivers;
create policy excursions_operacional_select on public.excursions for select using (
  public.current_role_name() = 'operacional' and (
    public.has_access_permission('dashboard') or public.has_access_permission('agenda') or
    public.has_access_permission('relatorios') or public.has_access_permission('validacoes')
  )
);
create policy excursions_operacional_insert on public.excursions for insert with check (
  public.current_role_name() = 'operacional' and public.has_access_permission('solicitacao', true)
);
create policy excursions_operacional_update on public.excursions for update using (
  public.current_role_name() = 'operacional' and public.has_access_permission('agenda', true)
) with check (
  public.current_role_name() = 'operacional' and public.has_access_permission('agenda', true)
);
create policy excursion_drivers_operacional_write on public.excursion_drivers for all using (
  public.current_role_name() = 'operacional' and public.has_access_permission('agenda', true)
) with check (
  public.current_role_name() = 'operacional' and public.has_access_permission('agenda', true)
);
create policy doc_history_operacional_select on public.excursion_doc_history for select using (
  public.current_role_name() = 'operacional' and public.has_access_permission('validacoes')
);
create policy doc_history_operacional_insert on public.excursion_doc_history for insert with check (
  public.current_role_name() = 'operacional' and public.has_access_permission('validacoes', true)
);
create policy km_logs_operacional_select on public.driver_km_logs for select using (
  public.current_role_name() = 'operacional' and public.has_access_permission('km')
);
create policy km_logs_operacional_write on public.driver_km_logs for all using (
  public.current_role_name() = 'operacional' and public.has_access_permission('km', true)
) with check (
  public.current_role_name() = 'operacional' and public.has_access_permission('km', true)
);
create policy vehicles_operacional_write on public.vehicles for all using (
  public.current_role_name() = 'operacional' and public.has_access_permission('veiculos', true)
) with check (
  public.current_role_name() = 'operacional' and public.has_access_permission('veiculos', true)
);
create policy drivers_operacional_write on public.drivers for all using (
  public.current_role_name() = 'operacional' and public.has_access_permission('motoristas', true)
) with check (
  public.current_role_name() = 'operacional' and public.has_access_permission('motoristas', true)
);

-- O trigger é a segunda barreira: mesmo uma chamada manual à API não pode alterar
-- uma viagem se o perfil não tiver "Agenda / Pode editar".
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
  if role_name = 'operacional' and (public.has_access_permission('agenda', true) or public.has_access_permission('validacoes', true)) then return new; end if;
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
