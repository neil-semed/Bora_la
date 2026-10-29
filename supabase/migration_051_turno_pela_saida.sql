-- ============================================================
-- BORA LÁ - migration_051: turno sempre calculado pelo horário de saída
-- Corrige viagens que tiveram o horário editado e mantém o turno certo daqui pra frente.
-- Manhã: antes de 12h · Tarde: 12h às 17h59 · Noite: a partir de 18h. Seguro rodar mais de uma vez.
-- ============================================================
create or replace function public.excursions_turno_pela_saida()
returns trigger language plpgsql as $$
begin
  if new.departure_time is not null then
    new.turno := case when new.departure_time < time '12:00' then 'manha'
                      when new.departure_time < time '18:00' then 'tarde'
                      else 'noite' end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_excursions_turno_pela_saida on public.excursions;
create trigger trg_excursions_turno_pela_saida
  before insert or update of departure_time, turno on public.excursions
  for each row execute function public.excursions_turno_pela_saida();

-- Corrige as viagens já gravadas com turno diferente do horário de saída.
-- No SQL Editor não há usuário logado: a trava de edição fica desligada só durante esta correção.
alter table public.excursions disable trigger trg_guard_excursion_update;
update public.excursions set turno = case when departure_time < time '12:00' then 'manha'
                                         when departure_time < time '18:00' then 'tarde'
                                         else 'noite' end
where departure_time is not null
  and turno is distinct from (case when departure_time < time '12:00' then 'manha'
                                   when departure_time < time '18:00' then 'tarde'
                                   else 'noite' end);

alter table public.excursions enable trigger trg_guard_excursion_update;
