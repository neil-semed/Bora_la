-- Bora Lá | Perfis administrativos: telas Pendências e Cooperativas.
-- Execute uma vez no SQL Editor.
-- Causa do erro "access_profiles_name_key": o catálogo de telas do banco não aceitava
-- "pendencias"/"cooperativas"; o perfil era criado, as permissões falhavam e, ao
-- salvar de novo, o nome já existia. Esta migration amplia o catálogo e libera a
-- leitura de viagens para quem tem a tela Pendências.
alter table public.access_profile_permissions drop constraint if exists access_profile_permissions_screen_key_check;
alter table public.access_profile_permissions add constraint access_profile_permissions_screen_key_check
  check (screen_key in ('dashboard', 'pendencias', 'agenda', 'solicitacao', 'relatorios', 'validacoes', 'km', 'veiculos', 'motoristas', 'cooperativas'));

drop policy if exists excursions_operacional_pendencias_select on public.excursions;
create policy excursions_operacional_pendencias_select on public.excursions for select using (
  public.current_role_name() = 'operacional' and public.has_access_permission('pendencias')
);
