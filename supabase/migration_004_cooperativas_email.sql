-- ============================================================
-- BORA LÁ - EXCURSÕES | Migração 004: cooperativas e e-mail de ATF/PCD
-- Rode este arquivo no SQL Editor do Supabase DEPOIS do schema.sql e das
-- migrations 002 e 003. Ele só ADICIONA coisas (tabelas, coluna, políticas
-- novas) — não apaga nada do que você já tem cadastrado.
-- ============================================================

-- ------------------------------------------------------------
-- 1) COOPERATIVAS (nova tabela) - cada uma com seu e-mail próprio
-- ------------------------------------------------------------
create table if not exists cooperativas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  email text,
  phone text,
  created_at timestamptz default now()
);

alter table drivers add column if not exists cooperativa_id uuid references cooperativas(id) on delete set null;

-- ------------------------------------------------------------
-- 2) APP_SETTINGS (nova tabela) - nome/e-mail do setor de excursão, usado
--    na assinatura do e-mail preparado para a cooperativa
-- ------------------------------------------------------------
create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

insert into app_settings (key, value) values
  ('remetente_nome', 'Excursão Semed'),
  ('remetente_email', '')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 3) LISTAGEM GERAL DE PASSAGEIROS (nova tabela) - nome + CI/CNH/CPF de
--    cada passageiro, usada para montar o e-mail de pedido de ATF
-- ------------------------------------------------------------
create table if not exists excursion_passengers (
  id uuid primary key default gen_random_uuid(),
  excursion_id uuid not null references excursions(id) on delete cascade,
  nome text not null,
  documento text,
  created_at timestamptz default now()
);
create index if not exists idx_passengers_excursion on excursion_passengers(excursion_id);

-- ------------------------------------------------------------
-- 4) RLS das tabelas novas
-- ------------------------------------------------------------
alter table cooperativas enable row level security;
alter table app_settings enable row level security;
alter table excursion_passengers enable row level security;

drop policy if exists "cooperativas_select_all" on cooperativas;
create policy "cooperativas_select_all" on cooperativas for select using (auth.role() = 'authenticated');

drop policy if exists "cooperativas_write_admin" on cooperativas;
create policy "cooperativas_write_admin" on cooperativas for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

drop policy if exists "app_settings_select_all" on app_settings;
create policy "app_settings_select_all" on app_settings for select using (auth.role() = 'authenticated');

drop policy if exists "app_settings_write_admin" on app_settings;
create policy "app_settings_write_admin" on app_settings for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

drop policy if exists "passengers_select" on excursion_passengers;
create policy "passengers_select" on excursion_passengers for select
  using (
    exists (
      select 1 from excursions e
      where e.id = excursion_passengers.excursion_id
        and (
          public.current_role_name() in ('admin','pedagogia')
          or (public.current_role_name() = 'escola' and e.school_id = public.current_school_id())
          or (public.current_role_name() = 'motorista' and exists (
                select 1 from excursion_drivers ed
                where ed.excursion_id = e.id and ed.driver_id = public.current_driver_id()
              ))
        )
    )
  );

drop policy if exists "passengers_write" on excursion_passengers;
create policy "passengers_write" on excursion_passengers for all
  using (
    exists (
      select 1 from excursions e
      where e.id = excursion_passengers.excursion_id
        and (
          public.current_role_name() = 'admin'
          or (public.current_role_name() = 'escola' and e.school_id = public.current_school_id())
        )
    )
  )
  with check (
    exists (
      select 1 from excursions e
      where e.id = excursion_passengers.excursion_id
        and (
          public.current_role_name() = 'admin'
          or (public.current_role_name() = 'escola' and e.school_id = public.current_school_id())
        )
    )
  );

-- ------------------------------------------------------------
-- 5) Preenche cooperativas a partir do texto livre já cadastrado em
--    motoristas/veículos (pra não perder o que já está cadastrado) e liga
--    drivers.cooperativa_id automaticamente quando o nome bate.
-- ------------------------------------------------------------
insert into cooperativas (name)
  select distinct cooperative from drivers
  where cooperative is not null and trim(cooperative) <> ''
  and not exists (select 1 from cooperativas c where c.name = drivers.cooperative)
union
  select distinct cooperative from vehicles
  where cooperative is not null and trim(cooperative) <> ''
  and not exists (select 1 from cooperativas c where c.name = vehicles.cooperative);

update drivers set cooperativa_id = c.id
  from cooperativas c
  where drivers.cooperativa_id is null and drivers.cooperative = c.name;

-- ============================================================
-- Fim da migração 004. Nada aqui apaga dados existentes. As cooperativas
-- criadas acima vêm sem e-mail cadastrado — abra a tela "Cooperativas" no
-- sistema e complete o e-mail de cada uma antes de usar o botão de enviar
-- para a cooperativa.
-- ============================================================
