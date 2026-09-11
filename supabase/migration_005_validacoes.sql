-- ============================================================
-- BORA LÁ - EXCURSÕES | Migração 005: Validações pedagógicas (documento +
-- roteamento entre os 6 setores) e "Usuários" (perfil/setor pedagógico).
-- Rode este arquivo no SQL Editor do Supabase DEPOIS do schema.sql e das
-- migrations 002, 003 e 004. Ele só ADICIONA coisas (colunas/tabelas/
-- políticas novas) — não apaga nada do que você já tem cadastrado.
-- ============================================================

-- ------------------------------------------------------------
-- 1) PROFILES: setor pedagógico (só relevante para role = 'pedagogia')
-- ------------------------------------------------------------
alter table profiles add column if not exists setor_pedagogico text
  check (setor_pedagogico in ('educacao_infantil','ensino_fundamental','etnico_racial','educacao_inclusiva','tempo_integral','administracao'));

-- ------------------------------------------------------------
-- 2) EXCURSIONS: público-alvo (escolhido pela escola no pedido), o setor
--    pedagógico atual (pra onde a validação está roteada agora - pode ser
--    trocado via "encaminhar") e os campos do documento (projeto pedagógico)
-- ------------------------------------------------------------
alter table excursions add column if not exists publico_alvo text
  check (publico_alvo in ('educacao_infantil','fundamental_iniciais','fundamental_finais','ensino_medio','eja_adulto'));

alter table excursions add column if not exists setor_pedagogico_atual text
  check (setor_pedagogico_atual in ('educacao_infantil','ensino_fundamental','etnico_racial','educacao_inclusiva','tempo_integral','administracao'));

alter table excursions add column if not exists doc_status text not null default 'nao_enviado'
  check (doc_status in ('nao_enviado','em_analise','correcoes','aceito','rejeitado'));
alter table excursions add column if not exists doc_drive_file_id text;
alter table excursions add column if not exists doc_drive_url text;
alter table excursions add column if not exists doc_filename text;
alter table excursions add column if not exists doc_uploaded_at timestamptz;
alter table excursions add column if not exists doc_parecer_comentario text;
alter table excursions add column if not exists doc_parecer_por uuid references profiles(id);
alter table excursions add column if not exists doc_parecer_em timestamptz;

create index if not exists idx_excursions_setor_pedagogico on excursions(setor_pedagogico_atual);
create index if not exists idx_excursions_doc_status on excursions(doc_status);

-- Backfill: solicitações já existentes (criadas antes desta migração) ficam
-- com o documento marcado "Não se aplica" na prática - como não tinham público-
-- alvo, mandamos pro setor "Administração" (catch-all) só pra elas não ficarem
-- "perdidas" sem setor nenhum. Não mexe em nada que já foi aprovado/recusado.
update excursions set setor_pedagogico_atual = 'administracao'
  where setor_pedagogico_atual is null;

insert into app_settings (key, value) values ('drive_upload_url', '')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 3) HISTÓRICO DE VALIDAÇÃO (nova tabela) - registra cada parecer e cada
--    encaminhamento entre setores, pra manter rastro de quem fez o quê.
-- ------------------------------------------------------------
create table if not exists excursion_doc_history (
  id uuid primary key default gen_random_uuid(),
  excursion_id uuid not null references excursions(id) on delete cascade,
  evento text not null check (evento in ('enviado','reenviado','encaminhado','aceito','rejeitado','correcoes')),
  setor_origem text,
  setor_destino text,
  comentario text,
  por uuid references profiles(id),
  criado_em timestamptz default now()
);
create index if not exists idx_doc_history_excursion on excursion_doc_history(excursion_id);

alter table excursion_doc_history enable row level security;

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

-- ------------------------------------------------------------
-- 4) Defina o setor pedagógico de cada pessoa da Pedagogia (rode um comando
--    desses pra cada pedagogo/gestor, trocando o e-mail):
-- ------------------------------------------------------------
-- update profiles set setor_pedagogico = 'ensino_fundamental' where email = 'silvia@boralasemed.com.br';
-- update profiles set setor_pedagogico = 'educacao_infantil'  where email = 'fulana@boralasemed.com.br';
-- update profiles set setor_pedagogico = 'etnico_racial'      where email = '...';
-- update profiles set setor_pedagogico = 'educacao_inclusiva' where email = '...';
-- update profiles set setor_pedagogico = 'tempo_integral'     where email = '...';
-- update profiles set setor_pedagogico = 'administracao'      where email = '...';
--
-- Se preferir, isso também já dá pra fazer pela tela "🔑 Usuários" (Admin),
-- que agora tem o campo "Setor pedagógico" quando o perfil escolhido é Pedagogia.
