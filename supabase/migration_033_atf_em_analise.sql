-- Bora Lá | Corrige "excursions_atf_status_check" ao aprovar (Admin).
-- O app grava atf_status = 'em_analise' na aprovação de viagens que exigem ATF,
-- mas a constraint não aceitava esse valor. Execute uma vez no SQL Editor.
alter table public.excursions drop constraint if exists excursions_atf_status_check;
alter table public.excursions add constraint excursions_atf_status_check
  check (atf_status in ('nao_precisa','em_analise','nao_emitida','aguardando','emitida'));
