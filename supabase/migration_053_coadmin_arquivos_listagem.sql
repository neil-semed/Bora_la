-- ============================================================
-- BORA LÁ - migration_053: Co_Admin (perfil administrativo) e arquivos de listagem
-- Com "Agenda · editar", o perfil administrativo vê, envia e substitui os arquivos
-- de listagem por veículo, como o Admin (antes só Admin e Escola). Seguro rodar mais de uma vez.
-- ============================================================
drop policy if exists "listagem_files_operacional_select" on public.excursion_listagem_files;
create policy "listagem_files_operacional_select" on public.excursion_listagem_files for select using (
  public.current_role_name() = 'operacional'
  and (public.has_access_permission('agenda') or public.has_access_permission('pendencias') or public.has_access_permission('relatorios'))
);
drop policy if exists "listagem_files_operacional_insert" on public.excursion_listagem_files;
create policy "listagem_files_operacional_insert" on public.excursion_listagem_files for insert with check (
  public.current_role_name() = 'operacional' and public.has_access_permission('agenda', true)
);
drop policy if exists "listagem_files_operacional_delete" on public.excursion_listagem_files;
create policy "listagem_files_operacional_delete" on public.excursion_listagem_files for delete using (
  public.current_role_name() = 'operacional' and public.has_access_permission('agenda', true)
);
notify pgrst, 'reload schema';
