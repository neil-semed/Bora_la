-- Bora Lá | Correções do app do motorista e aprovação administrativa.
-- Execute este arquivo inteiro no SQL Editor depois da migration_027.
-- É seguro executá-lo mais de uma vez.

-- A interface já usa "aguarda_motorista" quando o Admin aprova uma viagem
-- que ainda não recebeu escala. A restrição antiga não continha esse valor.
alter table public.excursions drop constraint if exists excursions_situacao_check;
alter table public.excursions add constraint excursions_situacao_check
  check (situacao in (
    'sem_validacao',
    'aguarda_motorista',
    'aguarda_atf',
    'aprovada',
    'confirmada',
    'envio_coop',
    'reprovada',
    'cancelada',
    'sem_listagem'
  ));

