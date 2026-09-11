-- ============================================================
-- MIGRAÇÃO 009 - Documento de identificação do aluno PCD e do apoio
-- ============================================================
-- O que esta migração adiciona:
--  - excursion_pcd_students ganha "documento_aluno" e "documento_apoio": além do nome
--    do aluno com deficiência e do respectivo apoio imediato, agora também dá pra
--    registrar o número do documento de identificação (CI/CNH/CPF) de cada um, no
--    Passo 4 de 5 da tela "Nova Solicitação" - mesmo padrão já usado na listagem de
--    passageiros comum (excursion_passengers.documento).
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. É seguro rodar mais de uma vez.
-- ============================================================

alter table excursion_pcd_students add column if not exists documento_aluno text;
alter table excursion_pcd_students add column if not exists documento_apoio text;
