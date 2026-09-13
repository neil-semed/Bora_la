-- MIGRAÇÃO 020 - Agenda Geral do motorista
-- O motorista continua vendo todas as suas viagens. Além delas, pode ler somente
-- viagens já confirmadas pelo Admin e que possuam motorista atribuído, para compor
-- a tela "Agenda Geral". Não concede edição nem acesso a solicitações pendentes.

drop policy if exists "excursions_select" on public.excursions;
create policy "excursions_select" on public.excursions for select
  using (
    public.current_role_name() in ('admin','pedagogia')
    or (public.current_role_name() = 'escola' and school_id = public.current_school_id())
    or (public.current_role_name() = 'operacional' and public.has_access_permission('agenda', false))
    or (
      public.current_role_name() = 'motorista'
      and (
        exists (
          select 1 from public.excursion_drivers ed
          where ed.excursion_id = excursions.id and ed.driver_id = public.current_driver_id()
        )
        or (
          excursions.status in ('approved','in_transit','completed')
          and coalesce(excursions.situacao, '') not in ('cancelada','reprovada')
          and exists (select 1 from public.excursion_drivers ed where ed.excursion_id = excursions.id)
        )
      )
    )
  );
