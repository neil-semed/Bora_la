// ============================================================
// BORA LÁ - EXCURSÕES | Edge Function: km-bridge
//
// Bridge de LEITURA E ESCRITA pro MarkCarro gravar/ler os registros de KM
// (odômetro início/fim do dia) dos motoristas usando a MESMA base do Bora
// Lá (driver_km_logs) - pedido do usuário: um motorista que roda pelos 2
// sistemas (ex.: abre o KM pelo MarkCarro de manhã, fecha pelo Bora Lá à
// tarde) precisa ver e mexer no MESMO registro do dia, não em duas tabelas
// separadas que nunca se falam.
//
// Por que dá pra fazer isso com segurança mesmo sem RLS "enxergando" o
// usuário do MarkCarro (projeto Supabase diferente, login separado):
//   1) Toda chamada tem que vir com "Authorization: Bearer <token>" - o
//      token de SESSÃO do condutor logado no MarkCarro (não a anon key).
//   2) Esta função valida esse token chamando o próprio servidor de auth
//      do MarkCarro (GET .../auth/v1/user) - é o MarkCarro quem confirma
//      "esse token é válido e pertence a este e-mail", nunca confiamos no
//      e-mail que vier solto no corpo da requisição.
//   3) Quando a ação é sobre o registro de OUTRA pessoa (tela de gestão,
//      "Gerenciar KM"), confirmamos também que quem chamou é admin no
//      MarkCarro, lendo o profile dele lá (GET .../rest/v1/profiles) - de
//      novo, quem responde "essa pessoa é admin?" é o próprio MarkCarro.
// Ou seja: identidade e permissão continuam sendo decididas pelo sistema
// onde a pessoa realmente fez login: aqui só confiamos no que o MarkCarro
// confirma sobre o token que ele mesmo emitiu.
//
// Motorista no Bora Lá é achado/criado pelo E-MAIL (coluna nova e opcional
// "drivers.email" - ver supabase_km_bridge_migration.sql). Se o motorista
// do MarkCarro ainda não existe como "drivers" aqui, é criado automático
// (sem login, sem vínculo com veículo) na primeira vez que ele mexe em KM -
// pedido do usuário ("Criar automaticamente"). Histórico antigo do
// MarkCarro (tabela registros_km) NÃO é migrado (pedido do usuário,
// "Começar do zero") - só fica congelado lá como consulta.
//
// Ações (POST, body JSON com "action") - uma pra cada função que o api.js
// do MarkCarro já tinha pra tabela antiga registros_km:
//   registrar      { email_condutor, nome_condutor?, data, km_inicial, km_final?, ajustado? }
//   buscar_data    { email_condutor, data }
//   buscar_periodo { email_condutor, data_ini, data_fim }
//   atualizar      { id, data?, km_inicial?, km_final?, ajustado? }  (admin, ou o próprio dono do registro)
//   excluir        { id }                                            (só admin)
//   listar_todos   {}                                                (só admin)
//   vincular_motorista { driver_id, email }                          (só admin)
//
// Sempre devolve os registros no MESMO formato que o MarkCarro já usava
// (tabela antiga registros_km), pra não precisar mexer nas telas:
//   { id, email_condutor, data, km_inicial, km_final, ajustado, created_at }
//
// COMO PUBLICAR:
//   1. supabase login
//   2. supabase link --project-ref rjuzhscynuleypaewgak
//   3. supabase functions deploy km-bridge --no-verify-jwt
//      (--no-verify-jwt: quem chama não tem sessão NESTE projeto - a
//      autenticação de verdade é a checagem manual do token do MarkCarro,
//      feita dentro da própria função, passo 2 da explicação acima)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// URL/anon key do projeto MarkCarro - mesma natureza da BORA_LA_ANON_KEY
// que já vive em config.js do MarkCarro: chave pública, feita pra ficar em
// código de site, protegida pelo que cada função escolhe expor/aceitar, não
// pelo sigilo da chave. Só é possível validar o token de sessão de um
// condutor MarkCarro chamando o auth server DELE, por isso precisa estar
// aqui (Edge Function de outro projeto não tem esses valores automáticos).
const MARKCARRO_SUPABASE_URL = 'https://gvtgtdhfciqegnjqcqlf.supabase.co';
const MARKCARRO_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2dGd0ZGhmY2lxZWduanFjcWxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NTMyNDcsImV4cCI6MjEwNDEyOTI0N30.9E3-rFSagbTmz5cUcCBER0RMvlwi0oLSy6LwxWazWcs';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Confirma o token de sessão direto com o auth server do MarkCarro -
// devolve o e-mail (confiável, veio do próprio MarkCarro) ou null se o
// token for inválido/expirado.
async function verificarUsuarioMarkCarro(token: string): Promise<{ id: string; email: string } | null> {
  const resp = await fetch(`${MARKCARRO_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: MARKCARRO_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const user = await resp.json().catch(() => null);
  if (!user?.id || !user?.email) return null;
  return { id: user.id, email: user.email };
}

// Confirma se esse usuário (já validado acima) é admin, lendo o profile
// dele no MarkCarro - de novo, é o MarkCarro quem responde. A coluna de
// perfil no MarkCarro se chama "tipo" (valores: solicitante/condutor/admin),
// diferente do Bora Lá ("role"/motorista) - são vocabulários de cada app.
async function ehAdminMarkCarro(callerId: string, token: string): Promise<boolean> {
  const resp = await fetch(`${MARKCARRO_SUPABASE_URL}/rest/v1/profiles?select=tipo&id=eq.${encodeURIComponent(callerId)}`, {
    headers: { apikey: MARKCARRO_ANON_KEY, Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!resp || !resp.ok) return false;
  const linhas = await resp.json().catch(() => []);
  return Array.isArray(linhas) && linhas[0]?.tipo === 'admin';
}

// Normaliza CNH (só dígitos) e e-mail/nome (trim + minúsculo/maiúsculo) pra
// comparar entre os 2 sistemas sem cair em falso-negativo por formatação
// (espaço sobrando, pontuação na CNH, maiúscula/minúscula diferente) - CASO
// REAL: motorista Cristiano tinha registro de KM no Bora Lá mas sumia da
// tela "Gerenciar KM" do MarkCarro porque a comparação de CNH/e-mail era
// exata demais (string idêntica caractere a caractere).
function normalizarCnh(v: any): string {
  return String(v || '').replace(/\D/g, '');
}
function normalizarEmail(v: any): string {
  return String(v || '').trim().toLowerCase();
}
function normalizarNome(v: any): string {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function mapRegistro(log: any, email: string) {
  if (!log) return null;
  return {
    id: log.id,
    email_condutor: email,
    data: log.log_date,
    km_inicial: log.odometer_start,
    km_final: log.odometer_end,
    ajustado: !!log.ajustado,
    created_at: log.created_at,
  };
}

// Acha o motorista pelo e-mail (chave nova, ver migration) OU, se não achar,
// pela CNH (chave que já existia nos 2 sistemas antes de qualquer migration -
// MarkCarro tem profiles.cnh, Bora Lá tem drivers.cnh) - BUG CORRIGIDO (motorista
// já cadastrado no Bora Lá SEM e-mail preenchido: buscar só por e-mail nunca
// achava ele e criava um segundo cadastro duplicado, então o KM gravado pelo
// MarkCarro ia pro cadastro novo/vazio enquanto o histórico de verdade (e o que
// o Bora Lá já mostrava) continuava no cadastro antigo). Achando por CNH,
// aproveita o cadastro existente E grava o e-mail nele (só na primeira vez),
// pra da próxima vez achar direto pelo e-mail.
async function buscarDriverExistente(admin: any, email: string, cnh?: string | null): Promise<string | null> {
  // 1) e-mail, sem diferenciar maiúscula/minúscula nem espaço nas pontas
  //    (ilike sem "%" é comparação exata, só que case-insensitive).
  const { data: porEmail, error: e1 } = await admin
    .from('drivers').select('id').ilike('email', normalizarEmail(email)).maybeSingle();
  if (e1) throw new Error(e1.message);
  if (porEmail) return porEmail.id;

  // 2) CNH, comparando só os dígitos (ignora pontuação/espaço/formatação
  //    diferente entre os 2 sistemas) - busca todos os motoristas com CNH
  //    preenchida e compara normalizado em memória, já que o Postgres não
  //    tem como fazer esse "só dígitos" direto no filtro.
  const cnhAlvo = normalizarCnh(cnh);
  if (cnhAlvo) {
    const { data: candidatos, error: e2 } = await admin
      .from('drivers').select('id, email, cnh').not('cnh', 'is', null);
    if (e2) throw new Error(e2.message);
    const achado = (candidatos || []).find((d: any) => normalizarCnh(d.cnh) === cnhAlvo);
    if (achado) {
      // Preenche/corrige o e-mail se estiver vazio ou diferente do atual -
      // mesma CNH = mesma pessoa, então o e-mail mais recente do MarkCarro
      // é o certo (cobre e-mail trocado ou cadastrado com diferença de
      // formatação da primeira vez).
      if (normalizarEmail(achado.email) !== normalizarEmail(email)) {
        await admin.from('drivers').update({ email: normalizarEmail(email) }).eq('id', achado.id);
      }
      return achado.id;
    }
  }
  return null;
}

async function resolverOuCriarDriver(admin: any, email: string, nome?: string, cnh?: string | null): Promise<string> {
  const existenteId = await buscarDriverExistente(admin, email, cnh);
  if (existenteId) return existenteId;

  const { data: novo, error: e2 } = await admin
    .from('drivers')
    .insert({ name: nome || email, email, cnh: cnh || null, active: true })
    .select('id')
    .single();
  if (e2) throw new Error(e2.message);
  return novo.id;
}

async function buscarDriverPorEmail(admin: any, email: string, cnh?: string | null): Promise<string | null> {
  return await buscarDriverExistente(admin, email, cnh);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Não autenticado.' }, 401);

    const caller = await verificarUsuarioMarkCarro(token);
    if (!caller) return json({ error: 'Sessão inválida ou expirada.' }, 401);

    const body = await req.json().catch(() => ({}));
    const { action } = body || {};

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Autoriza acesso ao e-mail alvo: o próprio dono, OU um admin do MarkCarro.
    async function autorizarEmail(emailAlvo: string) {
      if (emailAlvo === caller!.email) return true;
      return await ehAdminMarkCarro(caller!.id, token);
    }

    if (action === 'registrar') {
      // Cobre os 2 usos que o MarkCarro já tinha pra registrarKM(): o
      // condutor abrindo o KM do dia (só km_inicial) E o admin criando um
      // registro completo direto pela tela "Gerenciar KM" (km_inicial +
      // km_final + ajustado:true de uma vez só).
      const { email_condutor, nome_condutor, cnh_condutor, data, km_inicial, km_final, ajustado } = body;
      if (!email_condutor || !data || km_inicial == null) return json({ error: 'Preencha e-mail, data e km inicial.' }, 400);
      if (!(await autorizarEmail(email_condutor))) return json({ error: 'Sem permissão.' }, 403);

      const driverId = await resolverOuCriarDriver(admin, email_condutor, nome_condutor, cnh_condutor);
      const novoRegistro: Record<string, unknown> = { driver_id: driverId, log_date: data, odometer_start: km_inicial, odometer_start_at: new Date().toISOString() };
      if (km_final != null) { novoRegistro.odometer_end = km_final; novoRegistro.odometer_end_at = new Date().toISOString(); }
      if (ajustado != null) novoRegistro.ajustado = ajustado;

      const { data: log, error } = await admin
        .from('driver_km_logs').insert(novoRegistro).select('*').single();
      if (error) return json({ error: error.message }, 400);
      return json({ data: mapRegistro(log, email_condutor) });
    }

    if (action === 'buscar_data') {
      const { email_condutor, cnh_condutor, data } = body;
      if (!email_condutor || !data) return json({ error: 'Informe e-mail e data.' }, 400);
      if (!(await autorizarEmail(email_condutor))) return json({ error: 'Sem permissão.' }, 403);

      const driverId = await buscarDriverPorEmail(admin, email_condutor, cnh_condutor);
      if (!driverId) return json({ data: null });
      const { data: log, error } = await admin
        .from('driver_km_logs').select('*').eq('driver_id', driverId).eq('log_date', data).maybeSingle();
      if (error) return json({ error: error.message }, 400);
      return json({ data: mapRegistro(log, email_condutor) });
    }

    if (action === 'buscar_periodo') {
      const { email_condutor, cnh_condutor, data_ini, data_fim } = body;
      if (!email_condutor || !data_ini || !data_fim) return json({ error: 'Informe e-mail e período.' }, 400);
      if (!(await autorizarEmail(email_condutor))) return json({ error: 'Sem permissão.' }, 403);

      const driverId = await buscarDriverPorEmail(admin, email_condutor, cnh_condutor);
      if (!driverId) return json({ data: [] });
      const { data: logs, error } = await admin
        .from('driver_km_logs').select('*').eq('driver_id', driverId)
        .gte('log_date', data_ini).lte('log_date', data_fim)
        .order('log_date', { ascending: false });
      if (error) return json({ error: error.message }, 400);
      return json({ data: (logs || []).map((l: any) => mapRegistro(l, email_condutor)) });
    }

    if (action === 'atualizar') {
      const { id, data, km_inicial, km_final, ajustado } = body;
      if (!id) return json({ error: 'Informe o id do registro.' }, 400);

      const { data: atual, error: eAtual } = await admin
        .from('driver_km_logs').select('*, drivers(email)').eq('id', id).maybeSingle();
      if (eAtual) return json({ error: eAtual.message }, 400);
      if (!atual) return json({ error: 'Registro não encontrado.' }, 404);
      const emailDono = atual.drivers?.email;
      if (!emailDono || !(await autorizarEmail(emailDono))) return json({ error: 'Sem permissão.' }, 403);

      const patch: Record<string, unknown> = {};
      if (data !== undefined) patch.log_date = data;
      if (km_inicial !== undefined) patch.odometer_start = km_inicial;
      if (km_final !== undefined) { patch.odometer_end = km_final; patch.odometer_end_at = new Date().toISOString(); }
      if (ajustado !== undefined) patch.ajustado = ajustado;

      const { data: log, error } = await admin
        .from('driver_km_logs').update(patch).eq('id', id).select('*').single();
      if (error) return json({ error: error.message }, 400);
      return json({ data: mapRegistro(log, emailDono) });
    }

    if (action === 'excluir') {
      const { id } = body;
      if (!id) return json({ error: 'Informe o id do registro.' }, 400);
      if (!(await ehAdminMarkCarro(caller.id, token))) return json({ error: 'Só administradores podem excluir.' }, 403);

      const { error } = await admin.from('driver_km_logs').delete().eq('id', id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'listar_todos') {
      if (!(await ehAdminMarkCarro(caller.id, token))) return json({ error: 'Só administradores podem listar todos os registros.' }, 403);

      const { data: logs, error } = await admin
        .from('driver_km_logs').select('*, drivers(id, email, cnh, name)').order('log_date', { ascending: false });
      if (error) return json({ error: error.message }, 400);

      // BUG CORRIGIDO (mesmo espírito do buscarDriverExistente por CNH acima,
      // mas aqui pra LISTA INTEIRA de uma vez): motorista do Bora Lá cadastrado
      // antes da migration não tem "email" preenchido - o filtro antigo
      // (l.drivers?.email) descartava a linha inteira da tela "Gerenciar KM" do
      // MarkCarro, mesmo com o registro existindo e aparecendo no próprio Bora
      // Lá (caso do Cristiano). Agora, pra quem não tem e-mail, busca o e-mail
      // no MarkCarro pela CNH (chave que já existia nos 2 sistemas) e completa
      // o cadastro aqui (backfill), em vez de simplesmente esconder a linha.
      //
      // CORREÇÃO 2 (o caso do Cristiano continuava sumindo mesmo com esse
      // backfill): a comparação de CNH era exata-caractere-por-caractere
      // (via filtro "in." do Postgrest) - qualquer diferença de formatação
      // (ponto, espaço, zero à esquerda) entre a CNH digitada no MarkCarro e
      // a CNH cadastrada no Bora Lá fazia o backfill não achar ninguém, e o
      // motorista sumia pra sempre da lista. Agora: 1) busca TODOS os perfis
      // do MarkCarro com CNH preenchida (não só um filtro exato) e compara só
      // os dígitos; 2) se ainda assim não achar (CNH vazia nos dois lados, ou
      // realmente diferente), tenta um último critério - nome completo igual
      // (maiúsculo, sem espaço duplicado) - já que motorista sem e-mail nem
      // CNH batendo, mas com o MESMO nome cadastrado nos 2 sistemas, é o
      // mesmo caso Cristiano relatado.
      const semEmail = (logs || []).filter((l: any) => !l.drivers?.email);
      if (semEmail.length) {
        const resp = await fetch(`${MARKCARRO_SUPABASE_URL}/rest/v1/profiles?select=email,cnh,nome&or=(cnh.not.is.null,nome.not.is.null)`, {
          headers: { apikey: MARKCARRO_ANON_KEY, Authorization: `Bearer ${token}` },
        }).catch(() => null);

        if (resp?.ok) {
          const perfis: any[] = await resp.json().catch(() => []);
          const emailPorCnh: Record<string, string> = {};
          const emailPorNome: Record<string, string> = {};
          perfis.forEach((p: any) => {
            const cnhNorm = normalizarCnh(p.cnh);
            if (cnhNorm && p.email) emailPorCnh[cnhNorm] = p.email;
            const nomeNorm = normalizarNome(p.nome);
            if (nomeNorm && p.email) emailPorNome[nomeNorm] = p.email;
          });

          const driversResolvidos: Record<string, string> = {}; // driver.id -> email
          for (const l of semEmail) {
            const driverId = l.drivers?.id;
            if (!driverId || driversResolvidos[driverId]) continue;
            const cnhNorm = normalizarCnh(l.drivers?.cnh);
            const nomeNorm = normalizarNome(l.drivers?.name);
            const emailAchado = (cnhNorm && emailPorCnh[cnhNorm]) || (nomeNorm && emailPorNome[nomeNorm]) || null;
            if (emailAchado) driversResolvidos[driverId] = emailAchado;
          }

          for (const [driverId, email] of Object.entries(driversResolvidos)) {
            await admin.from('drivers').update({ email }).eq('id', driverId);
          }

          (logs || []).forEach((l: any) => {
            if (!l.drivers?.email && driversResolvidos[l.drivers?.id]) {
              l.drivers.email = driversResolvidos[l.drivers.id];
            }
          });
        }
      }

      // CORREÇÃO 3 (a tentativa automática de CNH/nome pode não bater mesmo
      // assim - motorista sem CNH cadastrada em nenhum dos 2 sistemas, ou
      // nome digitado com pequena diferença entre eles): em vez de continuar
      // escondendo a linha (o comportamento de antes, que é exatamente o que
      // fez o Cristiano continuar sumindo mesmo depois da correção 2), agora
      // ela aparece na lista mesmo sem casar automático, marcada como
      // "_nao_vinculado" - a tela Gerenciar KM mostra um seletor pra admin
      // escolher manualmente qual condutor do MarkCarro é aquele motorista, e
      // essa escolha grava o e-mail de vez (ação "vincular_motorista" abaixo)
      // - depois disso o casamento automático por e-mail passa a funcionar
      // sempre, sem precisar repetir a escolha.
      return json({
        data: (logs || []).map((l: any) =>
          l.drivers?.email
            ? mapRegistro(l, l.drivers.email)
            : {
                id: l.id,
                email_condutor: null,
                data: l.log_date,
                km_inicial: l.odometer_start,
                km_final: l.odometer_end,
                ajustado: !!l.ajustado,
                created_at: l.created_at,
                _nao_vinculado: true,
                _driver_id: l.drivers?.id || null,
                _nome_bora_la: l.drivers?.name || null,
              }
        ),
      });
    }

    if (action === 'vincular_motorista') {
      // Admin escolhe manualmente, pela tela Gerenciar KM, qual condutor do
      // MarkCarro corresponde a um motorista do Bora Lá que não casou
      // automático (ver comentário na ação "listar_todos" acima).
      if (!(await ehAdminMarkCarro(caller.id, token))) return json({ error: 'Só administradores podem vincular motoristas.' }, 403);

      const { driver_id, email } = body;
      if (!driver_id || !email) return json({ error: 'Informe o motorista e o condutor.' }, 400);

      const { data: driverAtual, error: eAtual } = await admin
        .from('drivers').select('id').eq('id', driver_id).maybeSingle();
      if (eAtual) return json({ error: eAtual.message }, 400);
      if (!driverAtual) return json({ error: 'Motorista não encontrado.' }, 404);

      const { error } = await admin.from('drivers').update({ email: normalizarEmail(email) }).eq('id', driver_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Ação inválida.' }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
