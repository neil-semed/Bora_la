-- Fluxo operacional por ocorrência: ATF e PCD são listas independentes.
-- Execute esta migração depois da migration_014_security_hardening.sql.
alter table public.excursions
  add column if not exists atf_lista_enviada_em timestamptz,
  add column if not exists atf_lista_conferida_em timestamptz,
  add column if not exists atf_lista_conferida_por uuid references public.profiles(id),
  add column if not exists atf_cooperativa_enviado_em timestamptz,
  add column if not exists pcd_lista_enviada_em timestamptz,
  add column if not exists pcd_lista_conferida_em timestamptz,
  add column if not exists pcd_lista_conferida_por uuid references public.profiles(id),
  add column if not exists pcd_cooperativa_enviado_em timestamptz,
  add column if not exists atf_emitido_em timestamptz,
  add column if not exists atf_emitido_por uuid references public.profiles(id),
  add column if not exists atf_observacao text;

alter table public.excursions drop constraint if exists excursions_atf_status_check;
alter table public.excursions add constraint excursions_atf_status_check
  check (atf_status in ('nao_precisa','nao_emitida','aguardando','emitida'));

-- Normalização administrativa dos registros existentes. O gatilho de autorização
-- da migration 014 protege atualizações comuns; aqui ele é desativado somente dentro
-- da transação de migração e é reativado antes do commit.
begin;
alter table public.excursions disable trigger user;
update public.excursions
set atf_status = case
  when lower(coalesce(city, 'nova lima')) = 'nova lima'
   and lower(coalesce(origin_city, 'nova lima')) = 'nova lima' then 'nao_precisa'
  when atf_status = 'emitida' then 'emitida'
  when atf_cooperativa_enviado_em is not null then 'aguardando'
  else 'nao_emitida'
end;
alter table public.excursions enable trigger user;
commit;
