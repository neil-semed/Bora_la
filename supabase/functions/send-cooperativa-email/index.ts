// BORA LÁ - EXCURSÕES | envio transacional pelo Brevo.
//
// Secrets obrigatórios no Supabase:
// - BREVO_API_KEY: chave criada em Brevo > SMTP & API > API Keys.
// - BREVO_FROM_EMAIL: remetente já verificado no Brevo.
// - BREVO_FROM_NAME: opcional; padrão "Bora Lá - Excursões / Semed Nova Lima".
//
// A função preserva a autorização: administradores autenticados podem disparar
// e-mails; a cooperativa (agente_externo) só pode avisar o e-mail do setor. O destinatário e a cópia são recebidos do próprio sistema.

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

function emails(value: unknown) {
  return String(value || '')
    .split(/[;,\n]+/)
    .map((email) => email.trim())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const brevoKey = Deno.env.get('BREVO_API_KEY');
    const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
    const fromName = Deno.env.get('BREVO_FROM_NAME') || 'Bora Lá - Excursões / Semed Nova Lima';

    const authHeader = req.headers.get('Authorization') || '';
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Não autenticado.' }, 401);

    const { data: callerProfile } = await callerClient
      .from('profiles').select('role').eq('id', user.id).single();
    const ehAdmin = callerProfile?.role === 'admin';
    // Cooperativa (agente_externo): só pode avisar o e-mail do setor (aceite de ATF/PCD).
    const ehCooperativa = callerProfile?.role === 'agente_externo';
    if (!ehAdmin && !ehCooperativa) {
      return json({ error: 'Somente administradores podem enviar e-mails automáticos.' }, 403);
    }

    if (!brevoKey || !fromEmail) {
      return json({ error: 'Brevo não configurado. Cadastre BREVO_API_KEY e BREVO_FROM_EMAIL nos secrets do Supabase.' }, 500);
    }

    const body = await req.json();
    const to = emails(body?.to);
    const cc = emails(body?.cc);
    const subject = String(body?.subject || '').trim();
    const text = String(body?.text || '').trim();
    const html = String(body?.html || '').trim();
    if (!to.length || !subject || (!text && !html)) {
      return json({ error: 'Faltam destinatário, assunto e conteúdo do e-mail.' }, 400);
    }
    if (ehCooperativa) {
      const { data: settings } = await callerClient.from('app_settings').select('key,value').in('key', ['email_copia_setor', 'remetente_email']);
      const setor = new Set((settings || []).flatMap((r: { value: string }) => emails(r.value)).map((e) => e.toLowerCase()));
      if (cc.length || !to.every((e) => setor.has(e.toLowerCase()))) {
        return json({ error: 'A cooperativa só pode enviar avisos para o e-mail do setor.' }, 403);
      }
    }

    const payload: Record<string, unknown> = {
      sender: { email: fromEmail, name: fromName },
      to: to.map((email) => ({ email })),
      subject,
      ...(text ? { textContent: text } : {}),
      ...(html ? { htmlContent: html } : {}),
      ...(cc.length ? { cc: cc.map((email) => ({ email })) } : {}),
    };
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return json({ error: result.message || `O Brevo recusou o envio (HTTP ${resp.status}).` }, 502);
    }
    return json({ ok: true, id: result.messageId || result.message_id || null });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
