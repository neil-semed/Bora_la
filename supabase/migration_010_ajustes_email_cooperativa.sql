-- ============================================================
-- MIGRAÇÃO 010 - Ajustes no texto dos e-mails pra cooperativa e campo de e-mail
-- do solicitante avulso
-- ============================================================
-- O que esta migração adiciona:
--  - excursions ganha "requester_email": quando a unidade solicitante é "Outra (não
--    cadastrada)", o Passo 1 da tela "Nova Solicitação" agora tem campos separados de
--    Telefone e E-mail (antes era um único campo "Contato (telefone/e-mail)") -
--    requester_contact continua guardando o telefone, e o e-mail vai pra esta coluna
--    nova. Por enquanto esse e-mail só fica registrado - ainda não é usado nos e-mails
--    de ATF/PCD pra cooperativa (isso fica pra uma etapa futura, a definir).
--
-- Os textos dos e-mails de ATF e transporte PCD (Unidade/Endereço, "Estudante:"/"Apoio:"
-- na listagem PCD etc.) são só JavaScript (app.js) - não precisam de migração de banco.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. É seguro rodar mais de uma vez.
-- ============================================================

alter table excursions add column if not exists requester_email text;
