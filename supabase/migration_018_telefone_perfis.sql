-- Telefone do perfil solicitante. É copiado para a viagem no momento da criação,
-- preservando o contato que o motorista precisa consultar na agenda.
alter table public.profiles add column if not exists phone text;
