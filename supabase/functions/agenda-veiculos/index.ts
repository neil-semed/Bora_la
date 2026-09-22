// ============================================================
// BORA LÁ - EXCURSÕES | Edge Function: agenda-veiculos
//
// Bridge de LEITURA (só isso) pro MarkCarro conseguir montar uma agenda
// combinada mostrando quais placas já estão ocupadas nos dois sistemas no
// mesmo dia - MarkCarro é outro projeto Supabase (login/tabelas
// separados), então não tem como ele ler "excursions" direto por RLS.
//
// Só devolve o que é preciso pra evitar bater 2 vans no mesmo horário e pra
// identificar quem está escalado: data, turno, horários, destino, a(s)
// PLACA(s) e o NOME do motorista - nada de aluno, escola, documento,
// telefone etc. Não recebe nem devolve nenhum dado sensível, então não
// exige login: qualquer chamada com a anon key do projeto (que já é
// pública, fica no código do site) e dentro do período pedido funciona.
// Usa a chave de serviço (service_role) só INTERNAMENTE, pra enxergar
// todas as excursões (bypassando RLS), mas nunca devolve mais do que os
// campos listados abaixo.
//
// Considera "ocupando a van" o mesmo critério que o próprio app já usa em
// viagemConfirmadaParaMotorista() (app.js): status IN ('approved',
// 'in_transit','completed') E situacao NÃO IN ('cancelada','reprovada') -
// uma excursão pode continuar com status "approved" mesmo depois de
// cancelada/reprovada na "situação" (o campo mais detalhado), então
// checar só o status sozinho mostraria van ocupada por engano.
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
const SITUACAO_NAO_OCUPA = ['cancelada', 'reprovada'];
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

    const { data: excursions, error } = await admin
      .from('excursions')
      .select('id, trip_date, departure_time, return_time, turno, destination, status, situacao')
      .gte('trip_date', desde)
      .lte('trip_date', ate)
      .in('status', STATUS_OCUPA)
      .not('situacao', 'in', `(${SITUACAO_NAO_OCUPA.join(',')})`);

    if (error) return json({ error: error.message }, 400);

    // Motorista(s)/placa(s) de cada excursão: busca em 3 passos separados
    // (excursion_drivers -> drivers -> vehicles) e junta tudo aqui, em vez de
    // um único select com embed aninhado (excursions -> excursion_drivers ->
    // drivers -> vehicles) - o próprio app.js do Bora Lá já faz exatamente
    // assim (função loadExcursionDriversInto), então é o jeito comprovado de
    // funcionar aqui, sem depender de o PostgREST resolver um embed de 3
    // níveis através de uma tabela de junção.
    const ids = (excursions || []).map((e: any) => e.id);
    const excursionDrivers: any[] = ids.length
      ? (await admin.from('excursion_drivers').select('excursion_id, driver_id').in('excursion_id', ids)).data || []
      : [];

    const driverIds = [...new Set(excursionDrivers.map((ed) => ed.driver_id))];
    const driversData: any[] = driverIds.length
      ? (await admin.from('drivers').select('id, name, vehicle_id').in('id', driverIds)).data || []
      : [];
    const driverById: Record<string, any> = {};
    driversData.forEach((d) => { driverById[d.id] = d; });

    const vehicleIds = [...new Set(driversData.map((d) => d.vehicle_id).filter(Boolean))];
    const vehiclesData: any[] = vehicleIds.length
      ? (await admin.from('vehicles').select('id, plate').in('id', vehicleIds)).data || []
      : [];
    const plateById: Record<string, string> = {};
    vehiclesData.forEach((v) => { plateById[v.id] = v.plate; });

    const driversByExcursion: Record<string, string[]> = {};
    excursionDrivers.forEach((ed) => {
      (driversByExcursion[ed.excursion_id] = driversByExcursion[ed.excursion_id] || []).push(ed.driver_id);
    });

    // Achata: 1 linha por motorista/veículo escalado (uma excursão pode ter
    // mais de um) - só os campos não-sensíveis. O nome do motorista é
    // incluído (pedido do usuário, mesmo espírito do relatório "Escala" que
    // o próprio Bora Lá já expõe com nome de motorista) - não é um dado
    // sensível, é só quem está de plantão naquele horário.
    const linhas: any[] = [];
    for (const ex of excursions || []) {
      const escalados = (driversByExcursion[ex.id] || [])
        .map((driverId) => {
          const d = driverById[driverId];
          return { motorista: d?.name || null, placa: (d?.vehicle_id && plateById[d.vehicle_id]) || null };
        })
        .filter((e) => e.motorista || e.placa);
      const linhasBase = escalados.length ? escalados : [{ motorista: null, placa: null }];
      for (const { motorista, placa } of linhasBase) {
        linhas.push({
          sistema: 'bora_la',
          placa,
          motorista,
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
