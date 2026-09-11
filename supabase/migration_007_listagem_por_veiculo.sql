-- ============================================================
-- MIGRAÇÃO 007 - Listagem de passageiros por veículo (ATF/PCD)
-- ============================================================
-- O que esta migração adiciona:
--  - Quando a viagem precisa de cooperativa (destino fora de Nova Lima e/ou tem aluno
--    PCD) e já tem motorista(s) atribuído(s), a Escola passa a preencher UMA listagem
--    POR VEÍCULO (cada uma limitada à capacidade daquele veículo), com envio pro Google
--    Drive e aprovação do gestor antes de ir pra cooperativa (por e-mail, automático
--    quando configurado - veja README).
--  - excursion_passengers ganha "driver_id": diz de qual veículo/motorista é cada
--    passageiro da listagem (nulo = listagem antiga, sem separação por veículo).
--  - excursions ganha os campos de status/parecer da listagem (mesmo padrão já
--    usado pro doc_status do projeto pedagógico).
--  - Nova tabela excursion_listagem_files: 1 linha por arquivo de listagem enviado ao
--    Drive (1 por veículo).
--  - excursion_doc_history ganha uma coluna "tipo" (documento/listagem), pra registrar
--    o histórico da listagem no mesmo lugar que já registra o do projeto pedagógico.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. É seguro rodar mais de uma vez.
-- ============================================================

alter table excursions add column if not exists listagem_status text not null default 'nao_enviada'
  check (listagem_status in ('nao_enviada','enviada','aceita','rejeitada'));
alter table excursions add column if not exists listagem_enviada_em timestamptz;
alter table excursions add column if not exists listagem_parecer_por uuid references profiles(id);
alter table excursions add column if not exists listagem_parecer_em timestamptz;
alter table excursions add column if not exists listagem_parecer_comentario text;

alter table excursion_passengers add column if not exists driver_id uuid references drivers(id) on delete set null;
create index if not exists idx_passengers_driver on excursion_passengers(driver_id);

create table if not exists excursion_listagem_files (
  id uuid primary key default gen_random_uuid(),
  excursion_id uuid not null references excursions(id) on delete cascade,
  driver_id uuid references drivers(id) on delete set null,
  drive_file_id text,
  drive_url text,
  filename text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
create index if not exists idx_listagem_files_excursion on excursion_listagem_files(excursion_id);

alter table excursion_doc_history add column if not exists tipo text not null default 'documento'
  check (tipo in ('documento','listagem'));

alter table excursion_listagem_files enable row level security;

-- EXCURSION_LISTAGEM_FILES: mesma visibilidade da viagem-mãe; admin e a própria escola
-- inserem (é ela quem gera/envia o arquivo pro Drive na hora de enviar a listagem).
drop policy if exists "listagem_files_select" on excursion_listagem_files;
create policy "listagem_files_select" on excursion_listagem_files for select
  using (
    exists (
      select 1 from excursions e
      where e.id = excursion_listagem_files.excursion_id
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

drop policy if exists "listagem_files_insert" on excursion_listagem_files;
create policy "listagem_files_insert" on excursion_listagem_files for insert
  with check (
    exists (
      select 1 from excursions e
      where e.id = excursion_listagem_files.excursion_id
        and (
          public.current_role_name() = 'admin'
          or (public.current_role_name() = 'escola' and e.school_id = public.current_school_id())
        )
    )
  );
