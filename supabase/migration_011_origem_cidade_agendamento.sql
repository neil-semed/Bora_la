-- Bora Lá - origem/cidade para unidades e agendamentos externos
alter table schools add column if not exists city text;
alter table excursions add column if not exists solicitation_type text not null default 'excursao';
alter table excursions add column if not exists origin_name text;
alter table excursions add column if not exists origin_address text;
alter table excursions add column if not exists origin_city text;

-- Dados antigos: solicitações normais com school_id continuam usando a unidade como origem.
update excursions e
set origin_name = s.name,
    origin_address = coalesce(e.origin_address, s.address),
    origin_city = coalesce(e.origin_city, s.city)
from schools s
where e.school_id = s.id
  and coalesce(e.solicitation_type, 'excursao') = 'excursao'
  and e.origin_name is null;
