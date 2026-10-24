-- Bora Lá | migration 048
-- 1) Data da situação da viagem (situacao_em): gravada automaticamente a cada mudança de situação.
--    Vale para as mudanças a partir desta migração; registros antigos ficam sem data ("—").
-- 2) FAQ: tela ATF e PCD e Solicitações (Cooperativa) e perfil Financeiro.

alter table public.excursions add column if not exists situacao_em timestamptz;

create or replace function public.excursions_situacao_em()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.situacao_em := coalesce(new.situacao_em, now());
  elsif new.situacao is distinct from old.situacao then
    new.situacao_em := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_excursions_situacao_em on public.excursions;
create trigger trg_excursions_situacao_em
  before insert or update of situacao on public.excursions
  for each row execute function public.excursions_situacao_em();

insert into public.ajuda_faq (perfis, tela, pergunta, resposta, onde_clicar, ordem)
select * from (values
  (array['cooperativa'], 'atfpcdcoop', 'Onde vejo todos os pedidos de ATF e PCD?', 'Na tela ATF e PCD: pendentes, emitidos/confirmados e recusados, com filtros por data, unidade, motorista, tipo e situação.', 'Menu ATF e PCD', 31),
  (array['cooperativa'], 'atfpcdcoop', 'Como vejo e baixo a listagem?', 'No card, clique em Ver listagem (ou Ver lista PCD). Use PDF ou Excel para baixar; se a escola enviou arquivo, use Abrir arquivo.', 'ATF e PCD › card › Ver listagem', 32),
  (array['cooperativa'], 'atfpcdcoop', 'Posso emitir ou recusar a ATF por esta tela?', 'Sim. Nos pedidos aguardando: Aprovar e emitir ATF ou Reprovar (com motivo). No PCD: Confirmar atendimento ou Recusar.', 'ATF e PCD › card pendente', 33),
  (array['cooperativa'], 'atfpcdcoop', 'Como vejo pedidos de viagens já realizadas?', 'Desmarque Ocultar solicitações passadas. As viagens de hoje sempre aparecem.', 'ATF e PCD › filtros', 34),
  (array['cooperativa'], 'solicitacoescoop', 'O que mostra a tela Solicitações?', 'As viagens confirmadas com motoristas da sua cooperativa, com a situação da ATF e, quando houver, do PCD, com as datas de resposta.', 'Menu Solicitações', 35),
  (array['cooperativa'], 'solicitacoescoop', 'Como encontro uma viagem específica?', 'Use os filtros de data, unidade e motorista no topo da tela.', 'Solicitações › filtros', 36),
  (array['financeiro'], 'financeiro', 'O que é o aporte financeiro?', 'Pedido de recurso para despesas complementares da excursão, como pedágios, ingressos, diárias e alimentação. Não interfere na análise nem na realização da viagem.', null, 37),
  (array['financeiro'], 'financeiro', 'Como analiso um pedido de aporte?', 'Em Pendências financeiras, confira itens, valores e o orçamento anexado, quando houver.', 'Pendências financeiras › card', 38),
  (array['financeiro'], 'financeiro', 'O que significa deferir?', 'Autorizar o uso do recurso do caixa escolar para as despesas informadas. O parecer é opcional.', 'Pendências financeiras › Deferir', 39),
  (array['financeiro'], 'financeiro', 'E se eu indeferir?', 'Informe o motivo. A excursão segue normalmente, sem alteração.', 'Pendências financeiras › Indeferir', 40)
) as v(perfis, tela, pergunta, resposta, onde_clicar, ordem)
where not exists (select 1 from public.ajuda_faq f where f.pergunta = v.pergunta);
