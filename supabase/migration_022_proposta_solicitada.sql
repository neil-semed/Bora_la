-- Bora Lá | Solicitação formal de proposta pedagógica pelo Admin.
-- "solicitada" identifica que a próxima ação é da unidade, antes da análise da Pedagogia.

alter table public.excursions drop constraint if exists excursions_doc_status_check;
alter table public.excursions add constraint excursions_doc_status_check
  check (doc_status in ('nao_enviado','solicitada','em_analise','correcoes','aceito','rejeitado'));
