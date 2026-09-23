import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Não autenticado.' }, 401);
    const { data: profile } = await caller.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'admin') return json({ error: 'Somente administradores podem alterar senhas.' }, 403);

    const { user_id, password } = await req.json().catch(() => ({}));
    if (!user_id || typeof password !== 'string' || password.length < 8) return json({ error: 'Informe usuário e uma senha com no mínimo 8 caracteres.' }, 400);
    const admin = createClient(url, service);
    const { error } = await admin.auth.admin.updateUserById(user_id, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
});
