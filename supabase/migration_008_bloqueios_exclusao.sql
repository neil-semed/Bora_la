-- ============================================================
-- MIGRAÇÃO 008 - Bloquear/Reativar (usuários, cooperativas, unidades) e Excluir viagem
-- ============================================================
-- O que esta migração adiciona:
--  - profiles, schools e cooperativas ganham a coluna "active" (drivers e vehicles já
--    tinham desde o início). Com ela, o admin passa a poder "Bloquear"/"Reativar" um
--    usuário, uma cooperativa ou uma unidade escolar direto na tela correspondente:
--      * usuário bloqueado não consegue mais entrar no sistema (login recusado e,
--        se já estiver logado em outra aba, a sessão é encerrada);
--      * cooperativa/unidade bloqueada some das listas de "vincular a um motorista
--        novo"/"nova solicitação", mas todo o histórico já existente (viagens já
--        feitas, motoristas já vinculados etc.) continua intacto e visível.
--  - excursions ganha uma política de DELETE (só admin): a Agenda Mestra passa a ter
--    um botão "🗑️ Excluir" que remove a viagem de vez (diferente de "Cancelar", que
--    só muda a situação e mantém a viagem no histórico).
--
-- Por que bloquear/reativar em vez de excluir de verdade em Usuários/Cooperativas/
-- Motoristas/Veículos/Unidades, mas excluir de verdade em Agenda Mestra?
--   Isso foi verificado direto no banco (chaves estrangeiras e RLS):
--   - profiles: tem 10+ colunas em outras tabelas apontando pra ela (quem criou/
--     aprovou/comentou uma viagem, etc.) sem "on delete cascade" - o Postgres
--     recusaria excluir um usuário que já mexeu em alguma viagem. Bloquear evita
--     login sem perder esse histórico de autoria.
--   - drivers/vehicles: excursions.assigned_driver_id/assigned_vehicle_id apontam
--     pra eles sem cascade/set null - excluir um motorista/veículo que já foi usado
--     numa viagem seria recusado pelo banco. Bloquear "aposenta" sem essa perda.
--   - schools/cooperativas: tecnicamente o Postgres permitiria excluir (as FKs usam
--     "on delete set null"), mas isso apagaria pra sempre a atribuição histórica de
--     qual unidade/cooperativa pediu ou atendeu cada viagem antiga - um problema de
--     integridade dos relatórios, não de erro de banco. Por isso, mesmo sendo
--     tecnicamente possível, optou-se por bloquear aqui também.
--   - excursions: é a ÚNICA tabela do sistema em que excluir de vez é seguro nos dois
--     sentidos - o banco permite (nada aponta pra ela com restrição) e nada fica
--     órfão (tudo que depende de uma viagem - passageiros, listagens, comentários de
--     validação - está com "on delete cascade", ou seja, some junto automaticamente).
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. É seguro rodar mais de uma vez.
-- ============================================================

alter table profiles add column if not exists active boolean not null default true;
alter table schools add column if not exists active boolean not null default true;
alter table cooperativas add column if not exists active boolean not null default true;
-- (drivers e vehicles já têm "active" desde o schema original - nenhuma mudança necessária lá)

drop policy if exists "excursions_delete_admin" on excursions;
create policy "excursions_delete_admin" on excursions for delete
  using (public.current_role_name() = 'admin');
