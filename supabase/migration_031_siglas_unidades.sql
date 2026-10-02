-- Bora Lá | Siglas das unidades e preservação da sigla na solicitação.
-- Execute no SQL Editor depois da migration_030.
-- É seguro executar mais de uma vez.

alter table public.schools add column if not exists acronym text;
alter table public.excursions add column if not exists origin_acronym text;

-- Preserva nas viagens existentes a sigla que estiver cadastrada na unidade.
update public.excursions e
set origin_acronym = s.acronym
from public.schools s
where e.school_id = s.id
  and e.origin_acronym is null
  and s.acronym is not null;

