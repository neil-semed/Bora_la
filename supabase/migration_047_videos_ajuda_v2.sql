-- 047: vídeos próprios por pergunta (E7, E8, E9 e C4) no painel "?" (Ajuda).
-- Atualiza só as perguntas que ainda apontam para o vídeo antigo compartilhado
-- (não sobrescreve link trocado pelo Admin). Pode ser executada mais de uma vez.
update public.ajuda_faq f
   set video_url = v.novo
  from (values
    ('Minha proposta foi rejeitada. E agora?',   'assets/videos/E2_enviar_proposta_pedagogica.mp4', 'assets/videos/E7_proposta_rejeitada.mp4'),
    ('A Pedagogia pediu correções. O que faço?', 'assets/videos/E2_enviar_proposta_pedagogica.mp4', 'assets/videos/E8_correcoes_na_proposta.mp4'),
    ('Preciso corrigir a listagem já enviada.',  'assets/videos/E4_preencher_enviar_listagem.mp4',  'assets/videos/E9_corrigir_listagem_enviada.mp4'),
    ('Como baixo a listagem?',                   'assets/videos/C1_listagem_emitir_atf.mp4',        'assets/videos/C4_baixar_listagem.mp4')
  ) as v(pergunta, antigo, novo)
 where f.pergunta = v.pergunta
   and (coalesce(f.video_url, '') = '' or f.video_url = v.antigo);
