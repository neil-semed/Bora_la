-- ============================================================
-- BORA LÁ - migration_050: histórico de e-mails (tela Avisos › aba E-mails)
-- Um registro por envio (1 para 1, 1 para N ou 1 para todas). Seguro rodar mais de uma vez.
-- ============================================================
create table if not exists public.email_envios (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ultimo_envio_em timestamptz not null default now(),
  sent_by uuid,
  assunto text not null,
  mensagem text not null,
  modalidade text not null check (modalidade in ('um', 'varios', 'todas')),
  destinatarios jsonb not null default '[]'::jsonb,   -- [{tipo, id, nome, email}]
  status text not null default 'enviado' check (status in ('enviado', 'falhou')),
  erro text,
  tentativas integer not null default 1
);
create index if not exists email_envios_created_idx on public.email_envios(created_at desc);

alter table public.email_envios enable row level security;
drop policy if exists email_envios_select on public.email_envios;
drop policy if exists email_envios_insert on public.email_envios;
drop policy if exists email_envios_update on public.email_envios;
create policy email_envios_select on public.email_envios for select
  using (public.current_role_name() = 'admin' or public.has_access_permission('avisos', false));
create policy email_envios_insert on public.email_envios for insert
  with check (public.current_role_name() = 'admin' or public.has_access_permission('avisos', true));
create policy email_envios_update on public.email_envios for update
  using (public.current_role_name() = 'admin' or public.has_access_permission('avisos', true))
  with check (public.current_role_name() = 'admin' or public.has_access_permission('avisos', true));

notify pgrst, 'reload schema';
