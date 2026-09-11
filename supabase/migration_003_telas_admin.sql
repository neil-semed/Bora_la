-- ============================================================
-- BORA LÁ - EXCURSÕES | Migração 003: telas do administrador
-- Rode este arquivo no SQL Editor do Supabase DEPOIS do schema.sql e da
-- migration_002_agenda_avancada.sql. Ele só ADICIONA coisas (colunas,
-- tabela nova, políticas novas) — não apaga nada do que você já tem
-- cadastrado.
-- ============================================================

-- ------------------------------------------------------------
-- 1) SCHOOLS (Unidades) -> e-mail e telefone próprios
-- ------------------------------------------------------------
alter table schools add column if not exists email text;
alter table schools add column if not exists phone text;

-- ------------------------------------------------------------
-- 2) DRIVERS -> vencimento da CNH
-- ------------------------------------------------------------
alter table drivers add column if not exists cnh_vencimento date;

-- ------------------------------------------------------------
-- 3) EXCURSIONS -> recorrência (grupo) e cancelamento
-- ------------------------------------------------------------
alter table excursions add column if not exists recurrence_group_id uuid;
alter table excursions add column if not exists cancel_reason text;
alter table excursions add column if not exists cancelled_by uuid references profiles(id);
alter table excursions add column if not exists cancelled_at timestamptz;
alter table excursions add column if not exists requester_address text;
alter table excursions add column if not exists requester_contact text;

create index if not exists idx_excursions_recurrence_group on excursions(recurrence_group_id);

-- ------------------------------------------------------------
-- 4) ALUNOS PCD por viagem (registro individual: nome, cadeirante, apoio)
-- ------------------------------------------------------------
create table if not exists excursion_pcd_students (
  id uuid primary key default gen_random_uuid(),
  excursion_id uuid not null references excursions(id) on delete cascade,
  nome_aluno text not null,
  cadeirante boolean not null default false,
  nome_apoio text,
  created_at timestamptz default now()
);
create index if not exists idx_pcd_students_excursion on excursion_pcd_students(excursion_id);

alter table excursion_pcd_students enable row level security;

drop policy if exists "pcd_students_select" on excursion_pcd_students;
create policy "pcd_students_select" on excursion_pcd_students for select
  using (
    exists (
      select 1 from excursions e
      where e.id = excursion_pcd_students.excursion_id
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

drop policy if exists "pcd_students_insert" on excursion_pcd_students;
create policy "pcd_students_insert" on excursion_pcd_students for insert
  with check (
    exists (
      select 1 from excursions e
      where e.id = excursion_pcd_students.excursion_id
        and (
          public.current_role_name() = 'admin'
          or (public.current_role_name() = 'escola' and e.school_id = public.current_school_id())
        )
    )
  );

drop policy if exists "pcd_students_write_admin" on excursion_pcd_students;
create policy "pcd_students_write_admin" on excursion_pcd_students for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

-- ------------------------------------------------------------
-- 5) EXCURSIONS -> escola pode atualizar (cancelar) as próprias viagens
--    (antes só admin/pedagogia/motorista atribuído podiam dar update)
-- ------------------------------------------------------------
drop policy if exists "excursions_update" on excursions;
create policy "excursions_update" on excursions for update
  using (
    public.current_role_name() in ('admin','pedagogia')
    or (public.current_role_name() = 'escola' and school_id = public.current_school_id())
    or (public.current_role_name() = 'motorista' and exists (
          select 1 from excursion_drivers ed
          where ed.excursion_id = excursions.id and ed.driver_id = public.current_driver_id()
        ))
  )
  with check (
    public.current_role_name() in ('admin','pedagogia')
    or (public.current_role_name() = 'escola' and school_id = public.current_school_id())
    or (public.current_role_name() = 'motorista' and exists (
          select 1 from excursion_drivers ed
          where ed.excursion_id = excursions.id and ed.driver_id = public.current_driver_id()
        ))
  );

-- ============================================================
-- Fim da migração 003. Nada aqui apaga dados existentes.
-- ============================================================
