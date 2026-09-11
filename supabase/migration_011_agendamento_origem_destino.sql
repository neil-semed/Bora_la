-- ============================================================
-- BORA LÁ - EXCURSÕES
-- Migração 011 - Agendamento recebido / Origem e destino
--
-- Regra:
--   excursao   = escola -> destino externo
--   agendamento = origem externa -> escola
--
-- school_id continua representando a unidade escolar vinculada
-- à solicitação. No agendamento recebido, portanto, school_id
-- será a escola de DESTINO.
-- ============================================================

-- ------------------------------------------------------------
-- 1) TIPO DA SOLICITAÇÃO
-- ------------------------------------------------------------

alter table excursions
  add column if not exists solicitation_type text
  not null default 'excursao';

-- Se a coluna já existir, garante que os valores permitidos
-- continuem corretos.
alter table excursions
  drop constraint if exists excursions_solicitation_type_check;

alter table excursions
  add constraint excursions_solicitation_type_check
  check (solicitation_type in ('excursao', 'agendamento'));


-- ------------------------------------------------------------
-- 2) ORIGEM REAL DO TRANSPORTE
-- ------------------------------------------------------------

alter table excursions
  add column if not exists origin_name text;

alter table excursions
  add column if not exists origin_address text;


-- ------------------------------------------------------------
-- 3) ÍNDICES
-- ------------------------------------------------------------

create index if not exists idx_excursions_solicitation_type
  on excursions(solicitation_type);

create index if not exists idx_excursions_origin_name
  on excursions(origin_name);


-- ============================================================
-- 4) DADOS EXISTENTES
--
-- As solicitações antigas continuam funcionando.
-- Para elas, a origem passa a ser a própria escola solicitante.
-- Não sobrescrevemos uma origem que eventualmente já exista.
-- ============================================================

update excursions e
set
  origin_name = coalesce(
    e.origin_name,
    e.requester_name,
    s.name
  ),
  origin_address = coalesce(
    e.origin_address,
    case
      when e.school_id is not null then s.address
      else e.requester_address
    end
  )
from schools s
where e.school_id = s.id
  and (
    e.origin_name is null
    or e.origin_address is null
  );


-- ============================================================
-- FIM DA MIGRAÇÃO 011
-- ============================================================
