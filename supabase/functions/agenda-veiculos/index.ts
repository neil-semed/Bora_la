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

// PEDIDO DO USUÁRIO ("mostrar o status da viagem, texto e demais
// informações... vide print"): mesmos rótulos/mesma conta que o próprio
// app.js do Bora Lá usa no card do motorista (SITUACAO_LABELS, ATF_LABELS,
// numeroViagensIndicadas) - repetidos aqui porque o MarkCarro não tem
// acesso a essas tabelas/lógica, só ao que esta function devolve.
const SITUACAO_LABELS: Record<string, string> = {
  sem_validacao: 'Sem Validação',
  aguarda_motorista: 'Aguarda motorista',
  aguarda_atf: 'Aguarda ATF',
  aprovada: 'Aprovada',
  confirmada: 'Confirmada',
  envio_coop: 'Envio Coop',
  reprovada: 'Reprovada',
  cancelada: 'Cancelada',
  sem_listagem: 'Sem Listagem',
};
const ATF_LABELS: Record<string, string> = {
  nao_precisa: 'Não Precisa',
  em_analise: 'Em análise',
  nao_emitida: 'Não Emitida',
  aguardando: 'Aguardando',
  emitida: 'Emitida',
};

// Em trajetos inteiramente dentro de Nova Lima, um único veículo pode fazer
// mais de uma volta - mesma regra de numeroViagensIndicadas()/
// viagemInteiraEmNovaLima() do app.js: só conta mais de 1 viagem quando tem
// EXATAMENTE 1 motorista/van escalado (senão o transporte já está dividido
// entre vans) e nem o destino nem a origem são fora de Nova Lima.
function cidadeEhForaDeNovaLima(cidade: string | null | undefined) {
  const c = String(cidade || '').trim().toLowerCase();
  return !!c && c !== 'nova lima';
}

// Marca de versão - some no JSON de resposta (campo "versao") só pra
// conseguirmos confirmar, olhando a própria resposta, se o deploy pegou o
// código mais recente ou se ainda está rodando uma versão antiga em cache
// - depois de resolvido o problema do nome do motorista, pode remover.
const VERSAO_FUNCAO = 'v4-debug-2026-09-23';

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

    let debug = false;
    if (req.method === 'GET') {
      const url = new URL(req.url);
      desde = url.searchParams.get('desde');
      ate = url.searchParams.get('ate');
      debug = url.searchParams.get('debug') === '1';
    } else if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      desde = body?.desde || null;
      ate = body?.ate || null;
      debug = !!body?.debug;
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
      .select('id, school_id, trip_date, departure_time, return_time, turno, destination, destination_address, city, origin_name, origin_address, origin_city, students_count, companions_count, requester_name, requester_contact, solicitation_type, status, situacao, atf_status')
      .gte('trip_date', desde)
      .lte('trip_date', ate)
      .in('status', STATUS_OCUPA)
      .not('situacao', 'in', `(${SITUACAO_NAO_OCUPA.join(',')})`);

    if (error) return json({ error: error.message }, 400);

    // PEDIDO DO USUÁRIO ("use a mesma configuração do card do bora lá, com
    // informações do solicitante e setor"): origem/solicitante têm a MESMA
    // regra de resolução que o próprio app.js já usa (originName/
    // requesterContact) - excursão normal usa a unidade (schools), agendamento/
    // externa usa origin_name/requester_name direto. Só busca "schools" (nome/
    // endereço/telefone) - nenhuma tabela de aluno/documento.
    const schoolIds = [...new Set((excursions || []).map((e: any) => e.school_id).filter(Boolean))];
    let schoolsData: any[] = [];
    if (schoolIds.length) {
      const r = await admin.from('schools').select('id, name, address, phone, city').in('id', schoolIds);
      schoolsData = r.data || [];
    }
    const schoolById: Record<string, any> = {};
    schoolsData.forEach((s) => { schoolById[s.id] = s; });

    // Motorista(s)/placa(s) de cada excursão: busca em 3 passos separados
    // (excursion_drivers -> drivers -> vehicles) e junta tudo aqui, em vez de
    // um único select com embed aninhado (excursions -> excursion_drivers ->
    // drivers -> vehicles) - o próprio app.js do Bora Lá já faz exatamente
    // assim (função loadExcursionDriversInto), então é o jeito comprovado de
    // funcionar aqui, sem depender de o PostgREST resolver um embed de 3
    // níveis através de uma tabela de junção.
    const ids = (excursions || []).map((e: any) => e.id);
    let erroExcursionDrivers: string | null = null;
    let erroDrivers: string | null = null;
    let erroVehicles: string | null = null;

    let excursionDrivers: any[] = [];
    if (ids.length) {
      const r = await admin.from('excursion_drivers').select('*').in('excursion_id', ids);
      if (r.error) erroExcursionDrivers = r.error.message;
      excursionDrivers = r.data || [];
    }

    const driverIds = [...new Set(excursionDrivers.map((ed) => ed.driver_id))];
    let driversData: any[] = [];
    if (driverIds.length) {
      const r = await admin.from('drivers').select('*').in('id', driverIds);
      if (r.error) erroDrivers = r.error.message;
      driversData = r.data || [];
    }
    const driverById: Record<string, any> = {};
    driversData.forEach((d) => { driverById[d.id] = d; });

    const vehicleIds = [...new Set(driversData.map((d) => d.vehicle_id).filter(Boolean))];
    let vehiclesData: any[] = [];
    if (vehicleIds.length) {
      const r = await admin.from('vehicles').select('*').in('id', vehicleIds);
      if (r.error) erroVehicles = r.error.message;
      vehiclesData = r.data || [];
    }
    const plateById: Record<string, string> = {};
    const capacityById: Record<string, number> = {};
    vehiclesData.forEach((v) => { plateById[v.id] = v.plate; capacityById[v.id] = v.capacity || 0; });

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
      const escola = ex.school_id ? schoolById[ex.school_id] : null;
      const origem = ex.solicitation_type === 'agendamento'
        ? (ex.origin_name || 'Entidade / Outro')
        : (escola?.name || ex.origin_name || 'Entidade / Outro');
      const enderecoOrigem = ex.origin_address || escola?.address || null;
      const nomeSolicitante = ex.requester_name || escola?.name || null;
      const telefoneSolicitante = ex.requester_contact || escola?.phone || null;
      const qtdPessoas = (ex.students_count || 0) + (ex.companions_count || 0);

      // "Número de viagens" (numeroViagensIndicadas() do app.js): só faz
      // sentido quando tem EXATAMENTE 1 motorista/van escalado (senão o
      // transporte já está dividido) e o trajeto é inteiro dentro de Nova
      // Lima (nem destino nem origem fora) - aí sim 1 van pode precisar
      // fazer mais de 1 volta pra levar todo mundo.
      const cidadeDestino = ex.city || null;
      const cidadeOrigem = ex.origin_city || escola?.city || null;
      const foraDeNovaLima = cidadeEhForaDeNovaLima(cidadeDestino) || cidadeEhForaDeNovaLima(cidadeOrigem);
      const driverIdsEscalados = driversByExcursion[ex.id] || [];
      let numeroViagens = 1;
      if (!foraDeNovaLima && driverIdsEscalados.length === 1) {
        const d = driverById[driverIdsEscalados[0]];
        const capacidade = (d?.vehicle_id && capacityById[d.vehicle_id]) || 0;
        if (capacidade > 0) numeroViagens = Math.max(1, Math.ceil(qtdPessoas / capacidade));
      }

      for (const { motorista, placa } of linhasBase) {
        linhas.push({
          sistema: 'bora_la',
          placa,
          motorista,
          data_viagem: ex.trip_date,
          turno: ex.turno,
          hora_saida: ex.departure_time,
          hora_retorno: ex.return_time,
          detalhe: `${origem || ''} → ${ex.destination || ''}`,
          status: ex.status,
          situacao: ex.situacao,
          situacao_label: SITUACAO_LABELS[ex.situacao] || ex.situacao,
          atf_status: ex.atf_status,
          atf_label: ATF_LABELS[ex.atf_status] || ex.atf_status,
          numero_viagens: numeroViagens,
          origem,
          destino: ex.destination,
          endereco_origem: enderecoOrigem,
          endereco_destino: ex.destination_address || null,
          qtd_pessoas: qtdPessoas,
          nome_solicitante: nomeSolicitante,
          telefone_solicitante: telefoneSolicitante,
        });
      }
    }

    const resposta: any = { versao: VERSAO_FUNCAO, data: linhas };
    if (debug) {
      resposta.debug = {
        excursoes_encontradas: (excursions || []).length,
        excursion_drivers_encontrados: excursionDrivers.length,
        excursion_drivers_amostra: excursionDrivers.slice(0, 3),
        drivers_encontrados: driversData.length,
        drivers_amostra: driversData.slice(0, 3),
        vehicles_encontrados: vehiclesData.length,
        vehicles_amostra: vehiclesData.slice(0, 3),
        erro_excursion_drivers: erroExcursionDrivers,
        erro_drivers: erroDrivers,
        erro_vehicles: erroVehicles,
      };
    }
    return json(resposta);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
