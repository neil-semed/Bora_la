-- Bora Lá | Perfil Co_Admin (perfil administrativo fixo, menus escolhidos pelo Admin).
-- Execute uma vez no SQL Editor, depois da migration_037.

-- 1) Perfil fixo
insert into public.access_profiles (name, active) values ('Co_Admin', true)
on conflict (name) do nothing;

-- 2) Telas Unidades e Validadores no catálogo de permissões
alter table public.access_profile_permissions drop constraint if exists access_profile_permissions_screen_key_check;
alter table public.access_profile_permissions add constraint access_profile_permissions_screen_key_check
  check (screen_key in ('dashboard', 'pendencias', 'agenda', 'solicitacao', 'relatorios', 'validacoes', 'km', 'veiculos', 'motoristas', 'cooperativas', 'unidades', 'validadores'));

-- 3) Gravação conforme a permissão "editar" do perfil
drop policy if exists schools_operacional_write on public.schools;
create policy schools_operacional_write on public.schools for all
  using (public.has_access_permission('unidades', true)) with check (public.has_access_permission('unidades', true));

drop policy if exists validation_sectors_operacional_write on public.validation_sectors;
create policy validation_sectors_operacional_write on public.validation_sectors for all
  using (public.has_access_permission('validadores', true)) with check (public.has_access_permission('validadores', true));
drop policy if exists validation_targets_operacional_write on public.validation_targets;
create policy validation_targets_operacional_write on public.validation_targets for all
  using (public.has_access_permission('validadores', true)) with check (public.has_access_permission('validadores', true));
drop policy if exists validator_sector_assignments_operacional_write on public.validator_sector_assignments;
create policy validator_sector_assignments_operacional_write on public.validator_sector_assignments for all
  using (public.has_access_permission('validadores', true)) with check (public.has_access_permission('validadores', true));

-- 4) Agenda Mestra com "editar": mesmas edições do Admin (excluir viagem e passageiros)
drop policy if exists excursions_operacional_delete on public.excursions;
create policy excursions_operacional_delete on public.excursions for delete
  using (public.current_role_name() = 'operacional' and public.has_access_permission('agenda', true));
drop policy if exists passengers_operacional_write on public.excursion_passengers;
create policy passengers_operacional_write on public.excursion_passengers for all
  using (public.has_access_permission('agenda', true)) with check (public.has_access_permission('agenda', true));
