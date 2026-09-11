// ============================================================
// BORA LÁ - EXCURSÕES | Edge Function: send-cooperativa-email
//
// Manda um e-mail de verdade (sem precisar abrir o programa de e-mail de ninguém)
// pra cooperativa, usado quando o gestor ACEITA a listagem de passageiros de uma
// viagem (tela Agenda/Listagem, botão "✅ Aceitar"). Só quem já é Admin no app
// consegue chamar essa função. Se a chave do serviço de e-mail (RESEND_API_KEY)
// ainda não estiver configurada, esta função devolve um erro claro e o app cai
// automaticamente pro fluxo manual de sempre (rascunho de e-mail pra você conferir
// e clicar em enviar) - ninguém fica travado esperando isso ser configurado.
//
// COMO PUBLICAR (uma vez só, veja o passo a passo completo no README):
//   1. Crie uma conta grátis em https://resend.com e pegue uma API key
//      (Dashboard -> API Keys -> Create API Key)
//   2. Instale a Supabase CLI e faça login (supabase login), se ainda não tiver
//   3. supabase link --project-ref <ref-do-seu-projeto>
//   4. supabase secrets set RESEND_API_KEY=re_xxxxxxxx
//   5. (opcional, recomendado) depois de verificar seu próprio domínio no Resend:
//      supabase secrets set RESEND_FROM="Excursão Semed <excursao@seudominio.com.br>"
//      Sem isso, os e-mails saem do remetente de testes do próprio Resend
//      (onboarding@resend.dev) - funciona, mas identifica como "teste" pra quem recebe.
//   6. supabase functions deploy send-cooperativa-email
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendKey = Deno.env.get('RESEND_API_KEY');

    // 1) Confirma que quem está chamando é um Admin de verdade
    const authHeader = req.headers.get('Authorization') || '';
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Não autenticado.' }, 401);

    const { data: callerProfile } = await callerClient
      .from('profiles').select('role').eq('id', user.id).single();
    if (!callerProfile || callerProfile.role !== 'admin') {
      return json({ error: 'Só administradores podem enviar e-mail automático pra cooperativa.' }, 403);
    }

    if (!resendKey) {
      return json({ error: 'RESEND_API_KEY não configurada neste projeto (veja o passo a passo no topo deste arquivo/README). Use o rascunho manual por enquanto.' }, 500);
    }

    // 2) Lê os dados do e-mail
    const body = await req.json();
    const { to, subject, text } = body || {};
    if (!to || !subject || !text) {
      return json({ error: 'Faltam campos (to/subject/text).' }, 400);
    }

    // 3) Envia via Resend (serviço de e-mail transacional)
    const from = Deno.env.get('RESEND_FROM') || 'Bora Lá <onboarding@resend.dev>';
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    const respJson = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return json({ error: respJson.message || `O Resend recusou o envio (HTTP ${resp.status}).` }, 502);
    }

    return json({ ok: true, id: respJson.id });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
