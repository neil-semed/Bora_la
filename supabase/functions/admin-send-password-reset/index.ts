// Solicita ao Supabase o e-mail de recuperação sem revelar ou definir senhas.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Método não suportado.' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const auth = req.headers.get('Authorization') || '';
  const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return reply({ error: 'Não autenticado.' }, 401);
  const { data: profile } = await caller.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return reply({ error: 'Somente Admin pode enviar recuperação para outro usuário.' }, 403);
  const { email } = await req.json();
  if (!email) return reply({ error: 'E-mail obrigatório.' }, 400);
  const { error } = await createClient(url, anon).auth.resetPasswordForEmail(email, { redirectTo: 'https://neil-semed.github.io/bora-la-excursoes/redefinir-senha.html' });
  if (error) return reply({ error: error.message }, 400);
  return reply({ ok: true });
});
