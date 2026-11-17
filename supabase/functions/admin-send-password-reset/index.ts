// Solicita ao Supabase o e-mail de recuperação sem revelar ou definir senhas.
// Admin: qualquer usuário. Co_Admin (permissão "usuarios"): todos, exceto Admin.
// Cada envio fica registrado em password_reset_log (migration_057).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Método não suportado.' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization') || '';
    const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return reply({ error: 'Não autenticado.' }, 401);
    const admin = createClient(url, service);

    const { data: me } = await admin.from('profiles').select('id, role, full_name, email, active').eq('id', user.id).maybeSingle();
    if (!me || me.active === false) return reply({ error: 'Usuário sem acesso.' }, 403);
    let ehAdmin = me.role === 'admin';
    if (!ehAdmin) {
      const { data: permitido } = await caller.rpc('has_access_permission', { p_screen_key: 'usuarios' });
      if (me.role !== 'operacional' || !permitido) return reply({ error: 'Sem permissão para redefinir senhas.' }, 403);
    }

    const { email, user_id } = await req.json().catch(() => ({}));
    if (!email && !user_id) return reply({ error: 'Informe o usuário.' }, 400);
    let q = admin.from('profiles').select('id, role, email, full_name, access_profile_id');
    q = user_id ? q.eq('id', user_id) : q.ilike('email', String(email).trim());
    const { data: alvo } = await q.maybeSingle();
    if (!alvo?.email) return reply({ error: 'Usuário não encontrado.' }, 404);

    if (!ehAdmin && alvo.role === 'admin') return reply({ error: 'A senha do Admin só pode ser redefinida pelo Admin.' }, 403);

    // O link de recuperação é gerado pelo Supabase e enviado pelo Brevo (mesmo remetente dos
    // demais e-mails do Bora Lá): o envio padrão do Supabase só entrega à equipe do projeto.
    const brevoKey = Deno.env.get('BREVO_API_KEY');
    const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
    const fromName = Deno.env.get('BREVO_FROM_NAME') || 'Bora Lá - Excursões / Semed Nova Lima';
    if (!brevoKey || !fromEmail) return reply({ error: 'Envio de e-mail (Brevo) não configurado nesta função.' }, 500);

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery', email: alvo.email, options: { redirectTo: 'https://neil-semed.github.io/Bora_la/redefinir-senha.html' },
    });
    const actionLink = link?.properties?.action_link;
    if (linkErr || !actionLink) return reply({ error: 'Não foi possível gerar o link: ' + (linkErr?.message || 'sem link') }, 400);

    const nome = String(alvo.full_name || '').replace(/[<>&"]/g, '');
    const html = `<div style="font-family:Arial,sans-serif;max-width:620px;color:#0f172a;line-height:1.5">
      <div style="font-size:18px;font-weight:bold">Bora Lá | Redefinição de senha</div><div style="font-size:12px;color:#475569">SEMED Nova Lima</div>
      <div style="height:3px;background:#16a34a;margin:8px 0 14px"></div>
      <p>Olá${nome ? ', ' + nome : ''},</p>
      <p>Foi solicitada a redefinição da sua senha de acesso ao Bora Lá. Clique no botão abaixo para criar uma nova senha:</p>
      <p style="text-align:center;margin:22px 0"><a href="${actionLink}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;font-weight:bold;padding:12px 26px;border-radius:8px">Criar nova senha</a></p>
      <p style="font-size:12px;color:#475569">O link vale por tempo limitado e só pode ser usado uma vez. Se você não pediu a redefinição, ignore este e-mail: sua senha atual continua valendo.</p>
      <p>Bora Lá - Excursões / Semed Nova Lima</p>
      <div style="margin-top:12px;padding:7px 10px;background:#f1f5f9;border-radius:6px;font-size:11px;font-weight:bold;color:#334155">Esta mensagem é automática. Não responda a este e-mail.</div></div>`;
    const envio = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { email: fromEmail, name: fromName }, to: [{ email: alvo.email, name: alvo.full_name || alvo.email }], subject: 'Bora Lá - redefinição de senha', htmlContent: html }),
    });
    if (!envio.ok) {
      const r = await envio.json().catch(() => ({}));
      return reply({ error: r.message || `O Brevo recusou o envio (HTTP ${envio.status}).` }, 502);
    }

    const { error: logErr } = await admin.from('password_reset_log').insert({
      target_profile_id: alvo.id, target_email: alvo.email, target_name: alvo.full_name || null,
      requested_by: me.id, requested_by_name: me.full_name || me.email || null, channel: 'email',
    });
    return reply({ ok: true, aviso: logErr ? 'E-mail enviado, mas o histórico não foi gravado: ' + logErr.message : null });
  } catch (err) {
    return reply({ error: String(err) }, 500);
  }
});
