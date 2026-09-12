-- Evita lembretes duplicados para a mesma ocorrência.
alter table public.excursions
  add column if not exists driver_reminder_24h_sent_at timestamptz;
