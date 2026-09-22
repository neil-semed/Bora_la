-- ============================================================
-- BORA LÁ - Migration: suporte ao km-bridge (integração de KM com MarkCarro)
-- ============================================================
-- Duas colunas novas, opcionais (não quebram nada que já existe):
--
-- 1) drivers.email: chave só de CONSULTA (não é login) pra achar/criar o
--    motorista aqui a partir do e-mail dele no MarkCarro. Fica NULL pra
--    todo motorista que só existe pelo Bora Lá mesmo.
--
-- 2) driver_km_logs.ajustado: sinaliza que aquele registro foi corrigido
--    manualmente por um admin (mesmo conceito que já existia na tela
--    "Gerenciar KM" do MarkCarro) - default false, não usado pela tela de
--    KM do próprio Bora Lá, só pelo km-bridge.
--
-- Rode isso uma vez no projeto Bora Lá (rjuzhscynuleypaewgak) antes de
-- publicar a Edge Function km-bridge.
-- ============================================================

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;

ALTER TABLE driver_km_logs ADD COLUMN IF NOT EXISTS ajustado BOOLEAN NOT NULL DEFAULT false;
