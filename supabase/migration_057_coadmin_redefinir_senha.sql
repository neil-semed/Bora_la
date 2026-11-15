-- ============================================================
-- BORA LÁ - migration_057: Co_Admin redefine senha (exceto Admin e Co_Admin)
-- 1) Tela "usuarios" no catálogo dos perfis administrativos (o Admin liga em
--    Perfis de acesso › Co_Admin › "Usuários · redefinir senha").
-- 2) Histórico das redefinições (gravado pela função admin-send-password-reset).
-- Seguro rodar mais de uma vez.
-- ============================================================

alter table public.access_profile_permissions drop constraint if exists access_profile_permissions_screen_key_check;
alter table public.access_profile_permissions add constraint access_profile_permissions_screen_key_check
  check (screen_key in ('dashboard', 'pendencias', 'agenda', 'solicitacao', 'relatorios', 'validacoes', 'km', 'veiculos', 'motoristas', 'cooperativas', 'unidades', 'validadores', 'carrosolicitacoes', 'carronova', 'ajuda', 'avisos', 'usuarios'));

create table if not exists public.password_reset_log (
  id uuid primary key default gen_random_uuid(),
  target_profile_id uuid references public.profiles(id) on delete set null,
  target_email text,
  target_name text,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_by_name text,
  channel text not null default 'email',
  created_at timestamptz not null default now()
);
create index if not exists password_reset_log_created_idx on public.password_reset_log(created_at desc);

alter table public.password_reset_log enable row level security;
-- Leitura: Admin e quem tem a tela "usuarios". Gravação: só a função (service role).
drop policy if exists "password_reset_log_select" on public.password_reset_log;
create policy "password_reset_log_select" on public.password_reset_log for select using (
  (select public.current_role_name()) = 'admin' or (select public.has_access_permission('usuarios'))
);
grant select on public.password_reset_log to authenticated;

notify pgrst, 'reload schema';
