-- Bora Lá | Pendências administrativas e controle de tratativa.
-- Uma solicitação recém-criada fica em Pendências até uma ação efetiva do Admin.

alter table public.excursions
  add column if not exists admin_processed_at timestamptz,
  add column if not exists admin_processed_by uuid references public.profiles(id);

create index if not exists idx_excursions_admin_processed
  on public.excursions(admin_processed_at, created_at desc);

-- Registra as datas adicionais escolhidas na solicitação apenas para auditoria e
-- consulta. Cada data continua sendo uma ocorrência independente em excursions.
alter table public.excursions
  add column if not exists selected_recurrence_dates jsonb not null default '[]'::jsonb;
