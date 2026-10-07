-- Bora Lá | Datas específicas de recorrência
-- Cada data escolhida continua sendo uma excursão independente, vinculada
-- pelo recurrence_group_id. Este valor identifica a origem do agrupamento.

alter table public.excursions
  drop constraint if exists excursions_recurrence_check;

alter table public.excursions
  add constraint excursions_recurrence_check
  check (recurrence in ('unico', 'semanal', 'quinzenal', 'mensal', 'datas_adicionais'));
