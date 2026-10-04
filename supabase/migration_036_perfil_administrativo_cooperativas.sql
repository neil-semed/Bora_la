-- Bora Lá | Perfil administrativo (novo perfil) com acesso à tela Cooperativas.
-- Execute uma vez no SQL Editor. Permite gravar em cooperativas somente quando o
-- perfil de acesso do usuário tem "Cooperativas" com a opção "editar".
drop policy if exists "cooperativas_operacional_write" on public.cooperativas;
create policy "cooperativas_operacional_write" on public.cooperativas for all
  using (public.has_access_permission('cooperativas', true))
  with check (public.has_access_permission('cooperativas', true));
