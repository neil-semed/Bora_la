-- 046: vídeos de treinamento (Escola, Pedagogia e Cooperativa) no painel "?" (Ajuda).
-- Pode ser executada mais de uma vez.
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
    ('Até quando posso cancelar?',                'assets/videos/E5_cancelar_viagem.mp4'),
    ('Onde vejo o que analisar?',                 'assets/videos/P1_encontrar_abrir_proposta.mp4'),
    ('O documento não abre.',                     'assets/videos/P1_encontrar_abrir_proposta.mp4'),
    ('Por que não consigo aceitar?',              'assets/videos/P2_dar_parecer.mp4'),
    ('Correções ou rejeitar?',                    'assets/videos/P2_dar_parecer.mp4'),
    ('A solicitação caiu no setor errado.',       'assets/videos/P3_encaminhar_outro_setor.mp4'),
    ('O que é "Sem setor responsável"?',          'assets/videos/P3_encaminhar_outro_setor.mp4'),
    ('Como emito a ATF?',                         'assets/videos/C1_listagem_emitir_atf.mp4'),
    ('Como baixo a listagem?',                    'assets/videos/C1_listagem_emitir_atf.mp4'),
    ('Como recuso um pedido?',                    'assets/videos/C2_recusar_com_motivo.mp4'),
    ('Por que recebi pedido PCD?',                'assets/videos/C3_confirmar_transporte_pcd.mp4')
  ) as v(pergunta, url)
 where f.pergunta = v.pergunta
   and coalesce(f.video_url, '') = '';
