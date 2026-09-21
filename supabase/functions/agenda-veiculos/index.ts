// ============================================================
// BORA LÁ - EXCURSÕES | Edge Function: agenda-veiculos
//
// Bridge de LEITURA (só isso) pro MarkCarro conseguir montar uma agenda
// combinada mostrando quais placas já estão ocupadas nos dois sistemas no
// mesmo dia - MarkCarro é outro projeto Supabase (login/tabelas
// separados), então não tem como ele ler "excursions" direto por RLS.
//
// Só devolve o que é preciso pra evitar bater 2 vans no mesmo horário:
// data, turno, horários, destino e a(s) PLACA(s) - nada de aluno, escola,
// documento, telefone etc. Não recebe nem devolve nenhum dado sensível,
// então não exige login: qualquer chamada com a anon key do projeto (que
// já é pública, fica no código do site) e dentro do período pedido
// funciona. Usa a chave de serviço (service_role) só INTERNAMENTE, pra
// enxergar todas as excursões (bypassando RLS), mas nunca devolve mais do
// que os campos listados abaixo.
//
// Considera "ocupando a van" (mesmo critério que a tela usa pro Admin):
// status IN ('approved','in_transit','completed') - exclui pending/
// pedagogy_approved (ainda não confirmada) e rejected.
//
// Parâmetros (GET, querystring, ou POST com body JSON): desde, ate (datas
// YYYY-MM-DD, obrigatórias, intervalo de no máximo 90 dias por chamada).
//
// COMO PUBLICAR:
//   1. supabase login
//   2. supabase link --project-ref rjuzhscynuleypaewgak
//   3. supabase functions deploy agenda-veiculos --no-verify-jwt
//      (--no-verify-jwt: MarkCarro chama isso sem sessão/login neste
//      projeto - só com a anon key no header apikey, que o Supabase já
//      exige por padrão em toda function)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const STATUS_OCUPA = ['approved', 'in_transit', 'completed'];
const LIMITE_DIAS = 90;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function diffDias(a: string, b: string) {
  return Math.abs((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    let desde: string | null = null;
    let ate: string | null = null;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      desde = url.searchParams.get('desde');
      ate = url.searchParams.get('ate');
    } else if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      desde = body?.desde || null;
      ate = body?.ate || null;
    } else {
      return json({ error: 'Método não suportado.' }, 405);
    }

    if (!desde || !ate || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
      return json({ error: 'Informe "desde" e "ate" no formato YYYY-MM-DD.' }, 400);
    }
    if (diffDias(desde, ate) > LIMITE_DIAS) {
      return json({ error: `Período máximo de ${LIMITE_DIAS} dias por chamada.` }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data, error } = await admin
      .from('excursions')
      .select(`
        trip_date,
        departure_time,
        return_time,
        turno,
        destination,
        status,
        excursion_drivers (
          drivers ( vehicle_id, vehicles ( plate ) )
        )
      `)
      .gte('trip_date', desde)
      .lte('trip_date', ate)
      .in('status', STATUS_OCUPA);

    if (error) return json({ error: error.message }, 400);

    // Achata: 1 linha por placa (uma excursão pode ter mais de um
    // motorista/veículo atribuído) - só os campos não-sensíveis.
    const linhas: any[] = [];
    for (const ex of data || []) {
      const veiculos = (ex.excursion_drivers || [])
        .map((ed: any) => ed?.drivers?.vehicles?.plate)
        .filter(Boolean);
      const placas = veiculos.length ? [...new Set(veiculos)] : [null];
      for (const placa of placas) {
        linhas.push({
          sistema: 'bora_la',
          placa,
          data_viagem: ex.trip_date,
          turno: ex.turno,
          hora_saida: ex.departure_time,
          hora_retorno: ex.return_time,
          detalhe: ex.destination,
          status: ex.status,
        });
      }
    }

    return json({ data: linhas });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
