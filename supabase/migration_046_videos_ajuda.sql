-- 046: vídeos de treinamento da Escola no painel "?" (Ajuda).
-- Preenche video_url só onde ainda está vazio (não sobrescreve link editado pelo Admin).
update public.ajuda_faq f
   set video_url = v.url
  from (values
    ('Como faço um pedido de viagem?',            'assets/videos/E1_fazer_pedido_de_viagem.mp4'),
    ('Como envio a proposta pedagógica?',         'assets/videos/E2_enviar_proposta_pedagogica.mp4'),
    ('Minha proposta foi rejeitada. E agora?',    'assets/videos/E2_enviar_proposta_pedagogica.mp4'),
    ('A Pedagogia pediu correções. O que faço?',  'assets/videos/E2_enviar_proposta_pedagogica.mp4'),
    ('Como confirmo a viagem?',                   'assets/videos/E3_confirmar_viagens.mp4'),
    ('Quando envio a listagem de passageiros?',   'assets/videos/E4_preencher_enviar_listagem.mp4'),
    ('Preciso corrigir a listagem já enviada.',   'assets/videos/E4_preencher_enviar_listagem.mp4'),
    ('Até quando posso cancelar?',                'assets/videos/E5_cancelar_viagem.mp4')
  ) as v(pergunta, url)
 where f.pergunta = v.pergunta
   and 'escola' = any(f.perfis)
   and coalesce(f.video_url, '') = '';
