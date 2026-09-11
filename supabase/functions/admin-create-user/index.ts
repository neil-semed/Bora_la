// ============================================================
// BORA LÁ - EXCURSÕES | Edge Function: admin-create-user
//
// Cria um login novo (e-mail + senha) direto pela tela "Usuários" do sistema,
// sem precisar entrar no painel do Supabase toda vez. Só quem já é Admin no
// app consegue chamar essa função (ela confere isso sozinha, olhando o token
// de quem está chamando).
//
// COMO PUBLICAR (uma vez só, veja o passo a passo completo no README):
//   1. Instale a Supabase CLI e faça login (supabase login)
//   2. supabase link --project-ref <ref-do-seu-projeto>
//   3. supabase functions deploy admin-create-user
// Pronto - a função já fica disponível em:
//   https://<seu-projeto>.supabase.co/functions/v1/admin-create-user
// (não precisa configurar nenhuma variável de ambiente: SUPABASE_URL,
// SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY já ficam disponíveis
// automaticamente pra toda Edge Function do seu projeto)
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

    // 1) Confirma que quem está chamando é um Admin de verdade (usa o próprio
    //    token de quem chamou, não a chave de serviço, pra essa checagem).
    const authHeader = req.headers.get('Authorization') || '';
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Não autenticado.' }, 401);

    const { data: callerProfile } = await callerClient
      .from('profiles').select('role').eq('id', user.id).single();
    if (!callerProfile || callerProfile.role !== 'admin') {
      return json({ error: 'Só administradores podem criar usuários.' }, 403);
    }

    // 2) Lê os dados do novo usuário
    const body = await req.json();
    const { email, password, full_name, role, school_id, driver_id, setor_pedagogico } = body || {};
    if (!email || !password || !role) {
      return json({ error: 'Preencha e-mail, senha e perfil.' }, 400);
    }
    if (!['admin', 'escola', 'pedagogia', 'motorista'].includes(role)) {
      return json({ error: 'Perfil inválido.' }, 400);
    }

    // 3) Cria o login (Auth) e o perfil (profiles), usando a chave de serviço
    //    (só disponível aqui no servidor - nunca no navegador)
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) return json({ error: createErr.message }, 400);

    const { error: profileErr } = await admin.from('profiles').upsert({
      id: created.user.id,
      email,
      full_name: full_name || null,
      role,
      school_id: role === 'escola' ? school_id || null : null,
      driver_id: role === 'motorista' ? driver_id || null : null,
      setor_pedagogico: role === 'pedagogia' ? setor_pedagogico || null : null,
    });
    if (profileErr) return json({ error: profileErr.message }, 400);

    return json({ ok: true, id: created.user.id });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
