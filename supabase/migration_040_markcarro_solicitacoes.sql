-- Bora Lá | Abas "Solicitações Carro" e "Nova Solicitação Carro" (MarkCarro).
-- Execute uma vez no SQL Editor, DEPOIS da migration_039.
-- As solicitações NÃO ficam no Bora Lá: são lidas/gravadas no MarkCarro pela Edge
-- Function "bora-la-solicitacoes" (projeto MarkCarro). Aqui só entram as duas
-- permissões novas no catálogo dos perfis de acesso (perfis nativos usam
-- role_screen_permissions, que não tem restrição de chave).

alter table public.access_profile_permissions drop constraint if exists access_profile_permissions_screen_key_check;
alter table public.access_profile_permissions add constraint access_profile_permissions_screen_key_check
  check (screen_key in ('dashboard', 'pendencias', 'agenda', 'solicitacao', 'relatorios', 'validacoes', 'km', 'veiculos', 'motoristas', 'cooperativas', 'unidades', 'validadores', 'carrosolicitacoes', 'carronova'));
