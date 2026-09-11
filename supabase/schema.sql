-- ============================================================
-- BORA LÁ - EXCURSÕES | Schema do Supabase
-- Semed Nova Lima/MG
--
-- Como usar:
-- 1. Crie um projeto em https://supabase.com
-- 2. Abra o "SQL Editor" do projeto
-- 3. Cole TODO este arquivo e clique em "Run"
-- 4. Depois crie os usuários (Authentication > Users > Add user)
--    e defina o "role" de cada um na tabela profiles (veja o final
--    deste arquivo, seção "PRIMEIRO ACESSO")
-- ============================================================

-- extensão para gen_random_uuid()
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- TABELAS
-- ------------------------------------------------------------

-- Escolas / Unidades (escolas pedem direto pelo site; "entidade" é uma
-- organização que pede por e-mail e o admin cadastra a solicitação por ela)
create table if not exists schools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  contact text,
  email text,
  phone text,
  tipo text not null default 'escola' check (tipo in ('escola','entidade')),
  active boolean not null default true,
  created_at timestamptz default now()
);

-- Perfis de usuário (1 linha por usuário do auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  role text not null check (role in ('admin','escola','pedagogia','motorista')) default 'escola',
  school_id uuid references schools(id) on delete set null,   -- obrigatório quando role='escola'
  driver_id uuid,                                              -- obrigatório quando role='motorista' (FK adicionada depois de criar drivers)
  -- setor pedagógico (obrigatório quando role='pedagogia') - define qual das 6 "estâncias"
  -- essa pessoa representa na tela de Validações (ela pode ver/mexer em qualquer solicitação,
  -- mas este é o setor "dela" por padrão, e pra onde volta se alguém encaminhar de volta)
  setor_pedagogico text check (setor_pedagogico in ('educacao_infantil','ensino_fundamental','etnico_racial','educacao_inclusiva','tempo_integral','administracao')),
  active boolean not null default true,
  created_at timestamptz default now()
);

-- Veículos
create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text unique not null,
  type text check (type in ('micro-onibus','van','onibus')) default 'micro-onibus',
  capacity int not null default 0,
  cooperative text,
  active boolean default true,
  created_at timestamptz default now()
);

-- Cooperativas de transporte (cada uma tem um e-mail próprio - é pra ele que
-- vai o pedido de ATF / transporte PCD, conforme o motorista vinculado)
create table if not exists cooperativas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  email text,
  phone text,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- Motoristas (cada motorista dirige sempre o próprio veículo)
create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnh text unique,
  cnh_vencimento date,
  phone text,
  cooperative text,
  cooperativa_id uuid references cooperativas(id) on delete set null,
  vehicle_id uuid references vehicles(id) on delete set null,
  active boolean default true,
  created_at timestamptz default now()
);

-- Configurações simples do sistema (chave/valor) - hoje usada só pra guardar
-- o nome/e-mail do setor de excursão, que entra na assinatura do e-mail
-- preparado para a cooperativa, sem precisar mudar código se um dia mudar.
create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

-- agora que drivers existe, liga profiles.driver_id -> drivers.id
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_driver_id_fkey'
  ) then
    alter table profiles
      add constraint profiles_driver_id_fkey
      foreign key (driver_id) references drivers(id) on delete set null;
  end if;
end $$;

-- Excursões (o coração do sistema)
create table if not exists excursions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id) on delete set null,
  turno text check (turno in ('manha','tarde','noite')),
  destination text not null,
  destination_address text,
  city text,
  trip_date date not null,
  departure_time time not null,
  return_time time,
  students_count int default 0,        -- exibido na tela como "Passageiros"
  pca_count int default 0,
  apoio_count int default 0,
  companions_count int default 0,
  recurrence text default 'unico' check (recurrence in ('unico','semanal','quinzenal','mensal')),
  notes text,

  -- fluxo de aprovação em 2 etapas: pedagogia -> admin (define motorista(s))
  status text not null default 'pending'
    check (status in ('pending','pedagogy_approved','approved','rejected','in_transit','completed')),
  rejection_reason text,

  pedagogy_approved_by uuid references profiles(id),
  pedagogy_approved_at timestamptz,

  -- Situação: campo principal que admin/pedagogia/escola acompanham (mais
  -- detalhado que o "status" acima, que continua controlando por baixo os
  -- botões de ação e o fluxo de execução em trânsito/concluída)
  atf_status text not null default 'nao_precisa' check (atf_status in ('nao_precisa','nao_emitida','emitida')),
  situacao text not null default 'sem_validacao'
    check (situacao in ('sem_validacao','aguarda_atf','aprovada','confirmada','envio_coop','reprovada','cancelada','sem_listagem')),
  envio_coop_data date,
  lista_escola boolean not null default false,
  requester_name text,
  requester_address text,   -- só preenchido pra unidade "Outra" (não cadastrada)
  requester_contact text,   -- idem (telefone)
  requester_email text,     -- idem (e-mail)

  -- Validação pedagógica por documento: a escola anexa o "projeto pedagógico" (vai pro
  -- Google Drive), a Pedagogia dá o parecer (aceitar/rejeitar/pedir correções) e pode
  -- encaminhar pra outro dos 6 setores se a solicitação caiu no setor errado.
  publico_alvo text check (publico_alvo in ('educacao_infantil','fundamental_iniciais','fundamental_finais','ensino_medio','eja_adulto')),
  setor_pedagogico_atual text check (setor_pedagogico_atual in ('educacao_infantil','ensino_fundamental','etnico_racial','educacao_inclusiva','tempo_integral','administracao')),
  doc_status text not null default 'nao_enviado' check (doc_status in ('nao_enviado','em_analise','correcoes','aceito','rejeitado')),
  doc_drive_file_id text,
  doc_drive_url text,
  doc_filename text,
  doc_uploaded_at timestamptz,
  doc_parecer_comentario text,
  doc_parecer_por uuid references profiles(id),
  doc_parecer_em timestamptz,

  -- Listagem de passageiros por veículo (viagens que precisam de cooperativa: fora de
  -- Nova Lima e/ou com aluno PCD). A escola preenche 1 listagem por veículo atribuído
  -- (limitada à capacidade dele), e o
  -- gestor aprova/rejeita antes de ir pra cooperativa por e-mail.
  listagem_status text not null default 'nao_enviada' check (listagem_status in ('nao_enviada','enviada','aceita','rejeitada')),
  listagem_enviada_em timestamptz,
  listagem_parecer_por uuid references profiles(id),
  listagem_parecer_em timestamptz,
  listagem_parecer_comentario text,

  -- recorrência: viagens "Continuado semanal/quinzenal/mensal" geram várias linhas
  -- (uma por ocorrência) que compartilham o mesmo recurrence_group_id. Aprovar a
  -- primeira aprova o grupo inteiro; recusar/cancelar afeta só aquela linha.
  recurrence_group_id uuid,

  -- cancelamento: pode ser feito pela própria escola solicitante ou pelo admin,
  -- linha por linha (mesmo numa série recorrente)
  cancel_reason text,
  cancelled_by uuid references profiles(id),
  cancelled_at timestamptz,

  -- mantidos por compatibilidade; a atribuição de verdade agora é multi-motorista (veja excursion_drivers)
  assigned_vehicle_id uuid references vehicles(id),
  assigned_driver_id uuid references drivers(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,

  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create index if not exists idx_excursions_trip_date on excursions(trip_date);
create index if not exists idx_excursions_status on excursions(status);
create index if not exists idx_excursions_situacao on excursions(situacao);
create index if not exists idx_excursions_turno on excursions(turno);
create index if not exists idx_excursions_school on excursions(school_id);
create index if not exists idx_excursions_driver on excursions(assigned_driver_id);
create index if not exists idx_excursions_recurrence_group on excursions(recurrence_group_id);

-- Ligação viagem <-> motorista(s): uma viagem pode ter mais de um motorista
-- (cada motorista dirige o próprio veículo, então o veículo é derivado daqui)
create table if not exists excursion_drivers (
  excursion_id uuid not null references excursions(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  primary key (excursion_id, driver_id)
);

-- Alunos PCD de uma viagem: registro individual (nome do aluno, se é cadeirante,
-- nome do apoio dele) - não é mais só um número solto.
create table if not exists excursion_pcd_students (
  id uuid primary key default gen_random_uuid(),
  excursion_id uuid not null references excursions(id) on delete cascade,
  nome_aluno text not null,
  cadeirante boolean not null default false,
  documento_aluno text,
  nome_apoio text,
  documento_apoio text,
  created_at timestamptz default now()
);
create index if not exists idx_pcd_students_excursion on excursion_pcd_students(excursion_id);

-- Listagem geral de passageiros de uma viagem (nome + CI/CNH/CPF) - é o que
-- entra no e-mail pedindo ATF pra cooperativa quando o destino é fora de
-- Nova Lima. Quem gera a ATF em si é a cooperativa; aqui só guardamos a
-- listagem que vamos mandar pra eles.
create table if not exists excursion_passengers (
  id uuid primary key default gen_random_uuid(),
  excursion_id uuid not null references excursions(id) on delete cascade,
  nome text not null,
  documento text,
  -- de qual veículo/motorista é este passageiro (viagens com listagem separada por
  -- veículo) - nulo numa listagem antiga/sem separação
  driver_id uuid references drivers(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_passengers_driver on excursion_passengers(driver_id);
create index if not exists idx_passengers_excursion on excursion_passengers(excursion_id);

create index if not exists idx_excursions_setor_pedagogico on excursions(setor_pedagogico_atual);
create index if not exists idx_excursions_doc_status on excursions(doc_status);

-- Histórico de validação por documento: um registro por parecer (aceito/rejeitado/
-- correções) e por encaminhamento entre setores - mantém rastro de quem fez o quê.
create table if not exists excursion_doc_history (
  id uuid primary key default gen_random_uuid(),
  excursion_id uuid not null references excursions(id) on delete cascade,
  -- "documento" = histórico do projeto pedagógico (Validações); "listagem" = histórico
  -- da listagem de passageiros por veículo (mesmos nomes de evento servem pros dois)
  tipo text not null default 'documento' check (tipo in ('documento','listagem')),
  evento text not null check (evento in ('enviado','reenviado','encaminhado','aceito','rejeitado','correcoes')),
  setor_origem text,
  setor_destino text,
  comentario text,
  por uuid references profiles(id),
  criado_em timestamptz default now()
);
create index if not exists idx_doc_history_excursion on excursion_doc_history(excursion_id);

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

-- Registro de KM (odômetro) dos motoristas - 1 linha por motorista por dia.
-- O km rodado é calculado sozinho (coluna gerada); admin pode corrigir
-- qualquer registro (relatórios por motorista/cooperativa/período).
create table if not exists driver_km_logs (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id) on delete cascade,
  log_date date not null,
  odometer_start numeric(10,1),
  odometer_start_at timestamptz,
  odometer_end numeric(10,1),
  odometer_end_at timestamptz,
  km_rodado numeric(10,1) generated always as (
    case when odometer_end is not null and odometer_start is not null
      then odometer_end - odometer_start
      else null end
  ) stored,
  observacoes text,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint driver_km_logs_um_por_dia unique (driver_id, log_date),
  constraint driver_km_logs_fim_maior_que_inicio check (
    odometer_end is null or odometer_start is null or odometer_end >= odometer_start
  )
);
create index if not exists idx_driver_km_logs_driver on driver_km_logs(driver_id);
create index if not exists idx_driver_km_logs_date on driver_km_logs(log_date);

-- ------------------------------------------------------------
-- FUNÇÃO AUXILIAR: papel do usuário logado
-- (security definer evita recursão de RLS ao consultar profiles
--  dentro das próprias políticas de profiles/excursions)
-- ------------------------------------------------------------
create or replace function public.current_role_name()
returns text
language sql
security definer
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_school_id()
returns uuid
language sql
security definer
stable
as $$
  select school_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_driver_id()
returns uuid
language sql
security definer
stable
as $$
  select driver_id from public.profiles where id = auth.uid();
$$;

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table profiles enable row level security;
alter table schools enable row level security;
alter table vehicles enable row level security;
alter table drivers enable row level security;
alter table cooperativas enable row level security;
alter table app_settings enable row level security;
alter table excursions enable row level security;
alter table excursion_drivers enable row level security;
alter table excursion_pcd_students enable row level security;
alter table excursion_passengers enable row level security;
alter table excursion_doc_history enable row level security;
alter table driver_km_logs enable row level security;
alter table excursion_listagem_files enable row level security;

-- PROFILES: usuário vê o próprio perfil; admin vê/edita todos
-- leitura liberada pra qualquer autenticado (precisamos disso pra mostrar o
-- "primeiro nome" de quem validou/aprovou uma viagem pra outros perfis); só
-- admin (ou o próprio dono da linha) pode alterar/inserir, isso continua igual
drop policy if exists "profiles_select_own_or_admin" on profiles;
create policy "profiles_select_authenticated" on profiles for select
  using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_own_or_admin" on profiles;
create policy "profiles_update_own_or_admin" on profiles for update
  using (id = auth.uid() or public.current_role_name() = 'admin');

drop policy if exists "profiles_insert_admin" on profiles;
create policy "profiles_insert_admin" on profiles for insert
  with check (public.current_role_name() = 'admin' or id = auth.uid());

-- SCHOOLS: todo usuário autenticado pode ler; só admin cria/edita
drop policy if exists "schools_select_all" on schools;
create policy "schools_select_all" on schools for select using (auth.role() = 'authenticated');

drop policy if exists "schools_write_admin" on schools;
create policy "schools_write_admin" on schools for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

-- VEHICLES: leitura geral; escrita só admin
drop policy if exists "vehicles_select_all" on vehicles;
create policy "vehicles_select_all" on vehicles for select using (auth.role() = 'authenticated');

drop policy if exists "vehicles_write_admin" on vehicles;
create policy "vehicles_write_admin" on vehicles for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

-- DRIVERS: leitura geral; escrita só admin
drop policy if exists "drivers_select_all" on drivers;
create policy "drivers_select_all" on drivers for select using (auth.role() = 'authenticated');

drop policy if exists "drivers_write_admin" on drivers;
create policy "drivers_write_admin" on drivers for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

-- COOPERATIVAS: leitura geral; escrita só admin
drop policy if exists "cooperativas_select_all" on cooperativas;
create policy "cooperativas_select_all" on cooperativas for select using (auth.role() = 'authenticated');

drop policy if exists "cooperativas_write_admin" on cooperativas;
create policy "cooperativas_write_admin" on cooperativas for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

-- APP_SETTINGS: leitura geral (precisa pra montar a assinatura do e-mail); escrita só admin
drop policy if exists "app_settings_select_all" on app_settings;
create policy "app_settings_select_all" on app_settings for select using (auth.role() = 'authenticated');

drop policy if exists "app_settings_write_admin" on app_settings;
create policy "app_settings_write_admin" on app_settings for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

-- EXCURSIONS: a regra principal do sistema
-- SELECT:
--   admin/pedagogia veem tudo
--   escola só vê viagens da própria escola
--   motorista só vê viagens já atribuídas a ele
drop policy if exists "excursions_select" on excursions;
create policy "excursions_select" on excursions for select
  using (
    public.current_role_name() in ('admin','pedagogia')
    or (public.current_role_name() = 'escola' and school_id = public.current_school_id())
    or (public.current_role_name() = 'motorista' and exists (
          select 1 from excursion_drivers ed
          where ed.excursion_id = excursions.id and ed.driver_id = public.current_driver_id()
        ))
  );

-- EXCURSION_DRIVERS: leitura geral (autenticado); escrita só admin
drop policy if exists "excursion_drivers_select" on excursion_drivers;
create policy "excursion_drivers_select" on excursion_drivers for select
  using (auth.role() = 'authenticated');

drop policy if exists "excursion_drivers_write_admin" on excursion_drivers;
create policy "excursion_drivers_write_admin" on excursion_drivers for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

-- INSERT: admin e escola podem solicitar; escola só para a própria escola
drop policy if exists "excursions_insert" on excursions;
create policy "excursions_insert" on excursions for insert
  with check (
    public.current_role_name() = 'admin'
    or (public.current_role_name() = 'escola' and school_id = public.current_school_id())
  );

-- UPDATE:
--   pedagogia só pode mudar o status (aprovar/recusar na etapa pedagógica)
--   admin pode tudo (atribuir veículo/motorista, aprovar final, marcar em trânsito/concluída)
--   motorista pode atualizar o status das suas próprias viagens (iniciar/concluir)
--   escola pode atualizar viagens da própria escola (usado só pra cancelar - o app só
--   manda um patch de cancelamento nesse caso, mas a política em si é por linha, não por coluna)
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

-- DELETE: só admin, e só aqui em excursions - é a única tabela do sistema em que apagar
-- de vez é seguro (tudo que depende de uma viagem tem "on delete cascade": passageiros,
-- listagens, comentários de validação etc. somem junto, sem deixar lixo nem violar FK).
drop policy if exists "excursions_delete_admin" on excursions;
create policy "excursions_delete_admin" on excursions for delete
  using (public.current_role_name() = 'admin');

-- EXCURSION_PCD_STUDENTS: mesma visibilidade da viagem-mãe (excursions); só
-- admin/escola inserem (no momento da solicitação), só admin edita depois.
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

-- EXCURSION_PASSENGERS: mesma visibilidade da viagem-mãe; admin e a própria
-- escola podem inserir/editar a listagem (pra montar o e-mail de ATF).
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

-- EXCURSION_DOC_HISTORY: mesma visibilidade da viagem-mãe; admin/pedagogia
-- registram pareceres e encaminhamentos, a própria escola registra reenvios.
drop policy if exists "doc_history_select" on excursion_doc_history;
create policy "doc_history_select" on excursion_doc_history for select
  using (
    exists (
      select 1 from excursions e
      where e.id = excursion_doc_history.excursion_id
        and (
          public.current_role_name() in ('admin','pedagogia')
          or (public.current_role_name() = 'escola' and e.school_id = public.current_school_id())
        )
    )
  );

drop policy if exists "doc_history_insert" on excursion_doc_history;
create policy "doc_history_insert" on excursion_doc_history for insert
  with check (
    exists (
      select 1 from excursions e
      where e.id = excursion_doc_history.excursion_id
        and (
          public.current_role_name() in ('admin','pedagogia')
          or (public.current_role_name() = 'escola' and e.school_id = public.current_school_id())
        )
    )
  );

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

-- DRIVER_KM_LOGS: motorista só grava/edita os próprios registros; admin
-- grava/edita e vê os de todo mundo (relatórios por motorista/cooperativa/período).
drop policy if exists "km_logs_select" on driver_km_logs;
create policy "km_logs_select" on driver_km_logs for select
  using (
    public.current_role_name() = 'admin'
    or (public.current_role_name() = 'motorista' and driver_id = public.current_driver_id())
  );

drop policy if exists "km_logs_insert" on driver_km_logs;
create policy "km_logs_insert" on driver_km_logs for insert
  with check (
    public.current_role_name() = 'admin'
    or (public.current_role_name() = 'motorista' and driver_id = public.current_driver_id())
  );

drop policy if exists "km_logs_update" on driver_km_logs;
create policy "km_logs_update" on driver_km_logs for update
  using (
    public.current_role_name() = 'admin'
    or (public.current_role_name() = 'motorista' and driver_id = public.current_driver_id())
  )
  with check (
    public.current_role_name() = 'admin'
    or (public.current_role_name() = 'motorista' and driver_id = public.current_driver_id())
  );

drop policy if exists "km_logs_delete_admin" on driver_km_logs;
create policy "km_logs_delete_admin" on driver_km_logs for delete
  using (public.current_role_name() = 'admin');

create or replace function public.set_km_logs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_km_logs_updated_at on driver_km_logs;
create trigger trg_km_logs_updated_at
  before update on driver_km_logs
  for each row execute function public.set_km_logs_updated_at();

-- ------------------------------------------------------------
-- DADOS DE EXEMPLO (opcional - remova se não quiser dados de teste)
-- ------------------------------------------------------------
insert into schools (name, address, contact) values
  ('EMEF Prof. João Silva', 'Rua das Flores, 100 - Centro', '(31) 3581-0000'),
  ('EMEF Maria Aparecida', 'Av. Brasil, 500 - Cristina', '(31) 3581-0001'),
  ('EE Prof. Carlos Drumond', 'Rua Minas Gerais, 200 - Vila Operária', '(31) 3581-0002')
on conflict do nothing;

insert into vehicles (plate, type, capacity, cooperative) values
  ('ABC-1234', 'micro-onibus', 32, 'CoopTrans'),
  ('DEF-5678', 'van', 15, 'CoopTrans'),
  ('GHI-9012', 'micro-onibus', 32, 'TransNova')
on conflict do nothing;

insert into cooperativas (name, email, phone) values
  ('CoopTrans', 'coopertrans@exemplo.com.br', '(31) 99999-0000'),
  ('TransNova', 'transnova@exemplo.com.br', '(31) 99999-0001')
on conflict do nothing;

insert into drivers (name, cnh, phone, cooperative, cooperativa_id) values
  ('João Silva', '01234567890', '(31) 99999-1111', 'CoopTrans', (select id from cooperativas where name = 'CoopTrans')),
  ('Pedro Santos', '09876543210', '(31) 99999-2222', 'CoopTrans', (select id from cooperativas where name = 'CoopTrans'))
on conflict do nothing;

insert into app_settings (key, value) values
  ('remetente_nome', 'Excursão Semed'),
  ('remetente_email', 'excursao.semed@pnl.mg.gov.br'),
  ('drive_upload_url', '')
on conflict do nothing;

-- ============================================================
-- PRIMEIRO ACESSO - como criar os usuários e ligar aos perfis
-- ============================================================
-- 1) No painel do Supabase: Authentication > Users > "Add user"
--    crie um usuário para cada pessoa (ex: admin@boralasemed.com.br)
--    marque "Auto Confirm User" para não precisar confirmar e-mail.
--
-- 2) Volte aqui no SQL Editor e rode um UPDATE para cada usuário,
--    definindo o papel (role) e, se for o caso, a escola/motorista:
--
--    -- vira ADMIN:
--    update profiles set role = 'admin'
--      where email = 'admin@boralasemed.com.br';
--
--    -- vira ESCOLA (troque o nome da escola pelo cadastrado acima):
--    update profiles set role = 'escola',
--      school_id = (select id from schools where name = 'EMEF Prof. João Silva')
--      where email = 'escola@boralasemed.com.br';
--
--    -- vira PEDAGOGIA:
--    update profiles set role = 'pedagogia'
--      where email = 'pedagogia@boralasemed.com.br';
--
--    -- vira MOTORISTA (troque pelo motorista cadastrado acima):
--    update profiles set role = 'motorista',
--      driver_id = (select id from drivers where name = 'João Silva')
--      where email = 'motorista@boralasemed.com.br';
--
-- Obs: a linha em "profiles" é criada automaticamente no primeiro
-- login de cada usuário pelo próprio app (veja app.js / loadUserProfile),
-- então faça o UPDATE depois do primeiro login de cada pessoa.
-- Se preferir criar a linha manualmente antes do primeiro login, use:
--   insert into profiles (id, email, role) values
--     ((select id from auth.users where email = 'admin@boralasemed.com.br'), 'admin@boralasemed.com.br', 'admin');
