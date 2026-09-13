// ============================================================
// BORA LÁ - EXCURSÕES | Lógica principal com Supabase
// ============================================================

// Credenciais públicas do projeto Supabase do Bora Lá (a chave "anon" é feita para ser
// pública - o que protege os dados de verdade são as regras de RLS no banco, não esta chave).
// Se algum dia precisar trocar de projeto sem mexer no código, ainda dá pra sobrescrever
// pela tela "⚙️ Configurar Supabase" (o que for salvo lá tem prioridade sobre isto aqui).
const DEFAULT_SUPABASE_URL = 'https://rjuzhscynuleypaewgak.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqdXpoc2N5bnVsZXlwYWV3Z2FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NTQwNDAsImV4cCI6MjEwNDIzMDA0MH0.enT2gJB4dy2xz_Z91tPY4ysoJ-GEEn2dpo_RHiy5jAs';

let sb = null;
let currentUser = null;
let wizardStep = 1;
let wizardMinStep = 1; // escola pula o passo 1 (unidade já é fixa) - ver resetWizard()
let wizardPcdList = []; // [{ nome_aluno, cadeirante, nome_apoio }] - alunos PCD da solicitação em andamento

let schools = [];
let vehicles = [];
let drivers = [];
let agenda = [];
// Estado da aba "Hoje" do motorista. Se ele não tiver escala na data corrente,
// exibimos a próxima escala para que a tela não pareça vazia por engano.
let motoristaHojeDataExibida = null;
let motoristaHojeUsaProximaData = false;
let cooperativas = [];
let appSettings = { remetente_nome: '', remetente_email: '' };
let notifications = [];
let unreadNotificationsSeen = null;
let allProfiles = []; // só carregada/usada de fato pelo admin, na tela "Usuários"
let demoProfiles = []; // equivalente à tabela "profiles" em modo demonstração
let validationSectors = [];
let validationTargets = [];
let validatorSectorAssignments = [];
let accessProfiles = [];
let accessProfilePermissions = [];
let editAccessProfileId = null;

// Catálogo fechado inicialmente às telas administrativas solicitadas. Assim, um
// perfil configurável não ganha por acidente acesso à gestão de usuários, frota ou
// aos fluxos pedagógicos específicos.
const ACCESS_SCREEN_CATALOG = [
  { key: 'dashboard', label: 'Dashboard', editable: false },
  { key: 'pendencias', label: 'Pendências', editable: false },
  { key: 'agenda', label: 'Agenda Mestra', editable: true },
  { key: 'solicitacao', label: 'Nova Solicitação', editable: true },
  { key: 'relatorios', label: 'Relatórios', editable: false },
  { key: 'validacoes', label: 'Validações pedagógicas', editable: true },
  { key: 'km', label: 'KM dos motoristas', editable: true },
  { key: 'veiculos', label: 'Veículos', editable: true },
  { key: 'motoristas', label: 'Motoristas', editable: true },
];

let assignTargetId = null;
let assignTargetTotalPax = 0; // total de passageiros da viagem sendo atribuída (pra checar lugares suficientes)
let rejectTargetId = null;
let cancelTargetId = null;
let passengerModalExcursionId = null;
let passengerModalReviewMode = false;
let passengerRows = []; // [{ nome, documento }] - listagem em edição no modal
let emailTargetId = null;
let editUserId = null;

// permissão de tela por perfil (espelha data-roles do index.html)
const SCREEN_ROLES = {
  dashboard: ['admin', 'escola', 'pedagogia', 'motorista'],
  pendencias: ['admin', 'pedagogia'],
  agenda: ['admin', 'escola', 'pedagogia', 'motorista'],
  agendadata: ['motorista'],
  agendageral: ['motorista'],
  solicitacao: ['admin', 'escola'],
  validacoes: ['escola', 'pedagogia'],
  km: ['admin', 'motorista'],
  unidades: ['admin'],
  veiculos: ['admin'],
  motoristas: ['admin'],
  cooperativas: ['admin'],
  usuarios: ['admin'],
  perfisacesso: ['admin'],
  validadores: ['admin'],
  relatorios: ['admin', 'escola', 'pedagogia'],
};

const ROLE_DEFAULT_SCREEN = {
  admin: 'dashboard',
  pedagogia: 'dashboard',
  escola: 'dashboard',
  motorista: 'agenda',
};

const ROLE_LABELS = { admin: 'Admin', escola: 'Escola', pedagogia: 'Pedagogia', motorista: 'Motorista', operacional: 'Administrativo' };

// "Situação" é o status principal que admin/pedagogia/escola acompanham (coluna com
// dropdown editável, igual à planilha usada hoje). O campo interno "status" continua
// controlando por baixo os botões de ação (aprovar/recusar/atribuir/iniciar/concluir).
const SITUACAO_LABELS = {
  sem_validacao: 'Sem Validação',
  aguarda_atf: 'Aguarda ATF',
  aprovada: 'Aprovada',
  confirmada: 'Confirmada',
  envio_coop: 'Envio Coop',
  reprovada: 'Reprovada',
  cancelada: 'Cancelada',
  sem_listagem: 'Sem Listagem',
};
const SITUACAO_COLORS = {
  sem_validacao: 'background:#e5e7eb;color:#374151',
  aguarda_atf: 'background:#fde68a;color:#92400e',
  aprovada: 'background:#bbf7d0;color:#166534',
  confirmada: 'background:#bfdbfe;color:#1e3a8a',
  envio_coop: 'background:#d6d3a1;color:#4d4600',
  reprovada: 'background:#fecaca;color:#7f1d1d',
  cancelada: 'background:#fee2e2;color:#991b1b',
  sem_listagem: 'background:#cbd5e1;color:#334155',
};
const ATF_LABELS = { nao_precisa: 'Não Precisa', nao_emitida: 'Não Emitida', aguardando: 'Aguardando', emitida: 'Emitida' };
const ATF_COLORS = {
  nao_precisa: 'background:#fef9c3;color:#854d0e',
  nao_emitida: 'background:#fee2e2;color:#991b1b',
  aguardando: 'background:#fef3c7;color:#92400e',
  emitida: 'background:#bbf7d0;color:#166534',
};

// Perfis de outros usuários (pra resolver "validador (primeiro nome)" etc).
let profilesById = {};

// ============ DADOS DE DEMONSTRAÇÃO (usados quando o Supabase não está configurado) ============
const DEMO_SCHOOLS = [
  { id: 's1', name: 'EMEF Prof. João Silva', address: 'Rua das Flores, 100 - Centro', city: 'Nova Lima', contact: '(31) 3581-0000', tipo: 'escola', active: true },
  { id: 's2', name: 'EMEF Maria Aparecida', address: 'Av. Brasil, 500 - Cristina', city: 'Nova Lima', contact: '(31) 3581-0001', tipo: 'escola', active: true },
  { id: 's3', name: 'EE Prof. Carlos Drumond', address: 'Rua Minas Gerais, 200 - Vila Operária', city: 'Nova Lima', contact: '(31) 3581-0002', tipo: 'escola', active: true },
  { id: 's4', name: 'Associação Comunitária Vila Rita', address: 'Rua Piauí, 80 - Vila Rita', city: 'Nova Lima', contact: '(31) 3581-0010', tipo: 'entidade', active: true },
];

const DEMO_VEHICLES = [
  { id: 'v1', plate: 'ABC-1234', type: 'micro-onibus', capacity: 32, cooperative: 'CoopTrans', active: true },
  { id: 'v2', plate: 'DEF-5678', type: 'van', capacity: 15, cooperative: 'CoopTrans', active: true },
  { id: 'v3', plate: 'GHI-9012', type: 'micro-onibus', capacity: 32, cooperative: 'TransNova', active: true },
];

const DEMO_COOPERATIVAS = [
  { id: 'c1', name: 'CoopTrans', email: 'coopertrans@exemplo.com.br', phone: '(31) 99999-0000', active: true },
  { id: 'c2', name: 'TransNova', email: 'transnova@exemplo.com.br', phone: '(31) 99999-0001', active: true },
];

// Cada motorista é dono do próprio veículo (vehicle_id) — dirige sempre o mesmo.
const DEMO_DRIVERS = [
  { id: 'd1', name: 'João Silva', cnh: '01234567890', phone: '(31) 99999-1111', cooperative: 'CoopTrans', cooperativa_id: 'c1', active: true, vehicle_id: 'v1' },
  { id: 'd2', name: 'Pedro Santos', cnh: '09876543210', phone: '(31) 99999-2222', cooperative: 'CoopTrans', cooperativa_id: 'c1', active: true, vehicle_id: 'v2' },
];

const DEMO_APP_SETTINGS = { remetente_nome: 'Excursão Semed', remetente_email: 'excursao.semed@pnl.mg.gov.br', drive_upload_url: '' };

// Perfis de exemplo pra tela "Usuários" funcionar em modo demonstração (no Supabase de
// verdade, essas linhas vêm da tabela profiles - uma por login que já acessou o sistema).
const DEMO_PROFILES = [
  { id: 'demo-admin', email: 'admin@teste.com', full_name: 'Admin Teste', role: 'admin', school_id: null, driver_id: null, setor_pedagogico: null, active: true },
  { id: 'demo-escola', email: 'escola@teste.com', full_name: 'Escola Teste', role: 'escola', school_id: 's1', driver_id: null, setor_pedagogico: null, active: true },
  { id: 'demo-pedagogia', email: 'pedagogia@teste.com', full_name: 'Pedagogia Teste', role: 'pedagogia', school_id: null, driver_id: null, setor_pedagogico: 'ensino_fundamental', active: true },
  { id: 'demo-motorista', email: 'motorista@teste.com', full_name: 'Motorista Teste', role: 'motorista', school_id: null, driver_id: 'd1', setor_pedagogico: null, active: true },
];

// Formata pelo calendário local. toISOString() usa UTC e, no Brasil à noite,
// transformava "hoje" em amanhã, escondendo viagens da tela do motorista.
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// Turno é sempre calculado a partir do horário de saída (não é mais escolhido à mão),
// pra nunca ficar desalinhado do horário de verdade da viagem.
function turnoFromHora(hhmm) {
  if (!hhmm) return null;
  const h = parseInt(hhmm.split(':')[0], 10);
  if (isNaN(h)) return null;
  if (h < 12) return 'manha';
  if (h < 18) return 'tarde';
  return 'noite';
}
const TURNO_LABELS = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };

// O Postgres devolve colunas "time" como "08:00:00" (com segundos) - a tela e os
// e-mails/relatórios devem sempre mostrar só "08:00".
function hhmm(t) { return t ? String(t).slice(0, 5) : '-'; }
function horaComH(t) { const hora = hhmm(t); return hora === '-' ? hora : `${hora}h`; }

// ============ VALIDAÇÃO PEDAGÓGICA (público-alvo, 6 setores, documento) ============
const PUBLICO_ALVO_LABELS = {
  educacao_infantil: 'Educação Infantil',
  fundamental_iniciais: 'Ens. Fundamental - Anos Iniciais',
  fundamental_finais: 'Ens. Fundamental - Anos Finais',
  ensino_medio: 'Ensino Médio',
  eja_adulto: 'EJA - Adulto',
};
const SETOR_PEDAGOGICO_LABELS = {
  educacao_infantil: 'Educação Infantil',
  ensino_fundamental: 'Ensino Fundamental',
  etnico_racial: 'Étnico-Racial',
  educacao_inclusiva: 'Educação Inclusiva',
  tempo_integral: 'Tempo Integral',
  administracao: 'Administração',
};
// Mapeia o público-alvo (escolhido pela escola no pedido) pro setor pedagógico que
// recebe a solicitação por padrão. Étnico-Racial/Educação Inclusiva/Tempo Integral não
// têm faixa etária própria - só entram por encaminhamento manual de quem analisar primeiro.
function setorPadraoPara(publicoAlvo) {
  const mapa = {
    educacao_infantil: 'educacao_infantil',
    fundamental_iniciais: 'ensino_fundamental',
    fundamental_finais: 'ensino_fundamental',
    ensino_medio: 'administracao',
    eja_adulto: 'administracao',
  };
  return mapa[publicoAlvo] || 'administracao';
}
const DOC_STATUS_LABELS = {
  nao_enviado: 'Aguardando envio',
  em_analise: 'Em análise',
  correcoes: 'Correções solicitadas',
  aceito: 'Aprovado',
  rejeitado: 'Rejeitado',
};
const DOC_STATUS_COLORS = {
  nao_enviado: 'background:#f1f5f9;color:#475569',
  em_analise: 'background:#dbeafe;color:#1e40af',
  correcoes: 'background:#fef3c7;color:#92400e',
  aceito: 'background:#d1fae5;color:#065f46',
  rejeitado: 'background:#fee2e2;color:#991b1b',
};

// ============ LISTAGEM DE PASSAGEIROS POR VEÍCULO (mesmo padrão do doc_status acima) ============
const LISTAGEM_STATUS_LABELS = {
  nao_enviada: 'Aguardando envio pela escola',
  enviada: 'Enviada - aguardando conferência',
  aceita: 'Aceita - encaminhada à(s) cooperativa(s)',
  rejeitada: 'Rejeitada - aguardando reenvio',
};
const LISTAGEM_STATUS_COLORS = {
  nao_enviada: 'background:#f1f5f9;color:#475569',
  enviada: 'background:#dbeafe;color:#1e40af',
  aceita: 'background:#d1fae5;color:#065f46',
  rejeitada: 'background:#fee2e2;color:#991b1b',
};

// ============ KM (ODÔMETRO) DOS MOTORISTAS ============
const DEMO_KM_LOGS = []; // [{ id, driver_id, log_date, odometer_start, odometer_start_at, odometer_end, odometer_end_at, km_rodado, observacoes }]
let kmLogs = [];

// Gera as datas de ocorrência de um evento "Continuado" (semanal/quinzenal/mensal),
// nos dias da semana marcados, entre a data inicial (inclusive) e a data final (inclusive).
function computeRecurrenceDates(startDateStr, endDateStr, recurrence, weekdays) {
  const start = new Date(startDateStr + 'T00:00');
  const end = new Date(endDateStr + 'T00:00');
  if (isNaN(start) || isNaN(end) || end < start || !weekdays.length) return [];
  const stepDays = recurrence === 'semanal' ? 7 : recurrence === 'quinzenal' ? 14 : 28;
  const weekStart = new Date(start);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const dates = [];
  let cursor = new Date(weekStart);
  while (cursor <= end) {
    weekdays.forEach((wd) => {
      const occ = new Date(cursor);
      occ.setDate(occ.getDate() + wd);
      if (occ >= start && occ <= end) dates.push(fmtDate(occ));
    });
    cursor.setDate(cursor.getDate() + stepDays);
  }
  return [...new Set(dates)].sort();
}

function buildDemoAgenda() {
  const today = new Date();
  const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return fmtDate(d); };
  const base = [
    { id: 'e1', school_id: 's1', destination: 'Museu de Ciências e Técnica', city: 'Belo Horizonte', trip_date: addDays(3), departure_time: '08:00', return_time: '17:00', students_count: 30, companions_count: 3, recurrence: 'unico', status: 'pending', situacao: 'sem_validacao', notes: '', created_by: null, publico_alvo: 'fundamental_iniciais', doc_status: 'em_analise', doc_filename: `${addDays(-1)}_emef-prof-joao-silva.pdf`, doc_uploaded_at: new Date().toISOString() },
    { id: 'e2', school_id: 's1', destination: 'Parque Ecológico', city: 'Nova Lima', trip_date: addDays(5), departure_time: '13:00', return_time: '17:30', students_count: 25, companions_count: 2, recurrence: 'unico', status: 'pedagogy_approved', situacao: 'aprovada', pedagogy_approved_at: new Date().toISOString(), notes: '', created_by: null },
    { id: 'e3', school_id: 's2', destination: 'Teatro Municipal', city: 'Belo Horizonte', trip_date: addDays(1), departure_time: '09:00', return_time: '12:00', students_count: 40, companions_count: 4, recurrence: 'unico', status: 'approved', situacao: 'confirmada', assigned_vehicle_id: 'v1', assigned_driver_id: 'd1', notes: '', created_by: null },
    { id: 'e4', school_id: 's2', destination: 'Cachoeira do Cardoso', city: 'Nova Lima', trip_date: addDays(0), departure_time: '07:30', return_time: '11:30', students_count: 15, companions_count: 2, recurrence: 'unico', status: 'in_transit', situacao: 'confirmada', assigned_vehicle_id: 'v2', assigned_driver_id: 'd2', notes: '', created_by: null },
    { id: 'e5', school_id: 's3', destination: 'Biblioteca Pública', city: 'Nova Lima', trip_date: addDays(-2), departure_time: '08:30', return_time: '11:00', students_count: 20, companions_count: 2, recurrence: 'unico', status: 'completed', situacao: 'confirmada', assigned_vehicle_id: 'v3', assigned_driver_id: 'd1', notes: '', created_by: null },
    { id: 'e6', school_id: 's3', destination: 'Parque Aquático', city: 'Contagem', trip_date: addDays(7), departure_time: '08:00', return_time: '18:00', students_count: 35, companions_count: 4, recurrence: 'unico', status: 'rejected', situacao: 'reprovada', rejection_reason: 'Fora do calendário letivo aprovado.', notes: '', created_by: null },
  ];
  // completa os campos novos (turno, ATF, motorista(s), etc.) em cima da base acima
  return base.map((a) => ({
    turno: 'manha',
    destination_address: null,
    pca_count: 0,
    apoio_count: 0,
    atf_status: a.city && !a.city.toLowerCase().includes('nova lima') ? 'nao_emitida' : 'nao_precisa',
    envio_coop_data: null,
    lista_escola: false,
    requester_name: (DEMO_SCHOOLS.find((s) => s.id === a.school_id) || {}).name || null,
    requester_address: null,
    requester_contact: null,
    requester_email: null,
    recurrence_group_id: null,
    cancel_reason: null,
    pcd_students: [],
    passengers: [],
    driver_ids: a.assigned_driver_id ? [a.assigned_driver_id] : [],
    created_at: new Date().toISOString(),
    publico_alvo: null,
    setor_pedagogico_atual: null,
    doc_status: 'nao_enviado',
    doc_drive_file_id: null,
    doc_drive_url: null,
    doc_filename: null,
    doc_uploaded_at: null,
    doc_parecer_comentario: null,
    doc_parecer_por: null,
    doc_parecer_em: null,
    listagem_status: 'nao_enviada',
    listagem_enviada_em: null,
    listagem_parecer_por: null,
    listagem_parecer_em: null,
    listagem_parecer_comentario: null,
    listagem_files: [],
    ...a,
  })).map((a) => ({ ...a, setor_pedagogico_atual: a.setor_pedagogico_atual || setorPadraoPara(a.publico_alvo) }));
}

// Modo demonstração agora precisa sobreviver à troca de página (login.html -> app.html
// -> volta pro login em outro perfil), então guardamos escolas/veículos/motoristas/agenda
// em sessionStorage em vez de só em memória. sessionStorage some quando a aba fecha, o que
// combina com a natureza "só para teste" do modo demonstração.
function loadDemoData() {
  const raw = sessionStorage.getItem('demoData');
  if (raw) {
    try {
      const d = JSON.parse(raw);
      schools = d.schools || DEMO_SCHOOLS;
      vehicles = d.vehicles || DEMO_VEHICLES;
      drivers = d.drivers || DEMO_DRIVERS;
      agenda = d.agenda || buildDemoAgenda();
      cooperativas = d.cooperativas || DEMO_COOPERATIVAS;
      appSettings = d.appSettings || { ...DEMO_APP_SETTINGS };
      demoProfiles = d.demoProfiles || DEMO_PROFILES.map((p) => ({ ...p }));
      kmLogs = d.kmLogs || buildDemoKmLogs();
      backfillDemoData();
      return;
    } catch (e) {
      console.warn('Não foi possível ler os dados de demonstração salvos, recomeçando:', e);
    }
  }
  schools = DEMO_SCHOOLS;
  vehicles = DEMO_VEHICLES;
  drivers = DEMO_DRIVERS;
  agenda = buildDemoAgenda();
  cooperativas = DEMO_COOPERATIVAS;
  appSettings = { ...DEMO_APP_SETTINGS };
  demoProfiles = DEMO_PROFILES.map((p) => ({ ...p }));
  kmLogs = buildDemoKmLogs();
  saveDemoData();
}

function saveDemoData() {
  sessionStorage.setItem('demoData', JSON.stringify({ schools, vehicles, drivers, agenda, cooperativas, appSettings, demoProfiles, kmLogs }));
}

// Gera um histórico de exemplo (últimos ~20 dias úteis) pro motorista d1, só pra o
// dashboard/gráfico de KM não nascer vazio em modo demonstração.
function buildDemoKmLogs() {
  const logs = [];
  const today = new Date();
  let odometer = 48000;
  for (let i = 20; i >= 1; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    if (d.getDay() === 0) continue; // pula domingo
    const rodado = 40 + Math.round(Math.random() * 60);
    const start = odometer;
    const end = odometer + rodado;
    odometer = end;
    logs.push({
      id: 'km_demo_' + i,
      driver_id: 'd1',
      log_date: fmtDate(d),
      odometer_start: start,
      odometer_start_at: new Date(d.setHours(6, 50)).toISOString(),
      odometer_end: end,
      odometer_end_at: new Date(d.setHours(18, 10)).toISOString(),
      km_rodado: rodado,
      observacoes: null,
    });
  }
  return logs;
}

// Preenche campos novos (Situação/ATF/turno/motorista(s)/tipo/veículo do motorista etc.)
// em dados de demonstração que ficaram salvos em sessionStorage de uma versão anterior
// do app, pra não quebrar uma sessão de teste já aberta.
function backfillDemoData() {
  schools.forEach((s) => { if (s.tipo === undefined) s.tipo = 'escola'; if (s.active === undefined) s.active = true; });
  drivers.forEach((d) => { if (d.vehicle_id === undefined) d.vehicle_id = null; if (d.cooperativa_id === undefined) d.cooperativa_id = null; });
  if (!cooperativas) cooperativas = DEMO_COOPERATIVAS;
  cooperativas.forEach((c) => { if (c.active === undefined) c.active = true; });
  if (!appSettings) appSettings = { ...DEMO_APP_SETTINGS };
  if (!demoProfiles || !demoProfiles.length) demoProfiles = DEMO_PROFILES.map((p) => ({ ...p }));
  demoProfiles.forEach((p) => { if (p.active === undefined) p.active = true; });
  if (!kmLogs) kmLogs = buildDemoKmLogs();
  agenda.forEach((a) => {
    if (a.driver_ids === undefined) a.driver_ids = a.assigned_driver_id ? [a.assigned_driver_id] : [];
    if (a.situacao === undefined) a.situacao = 'sem_validacao';
    if (a.atf_status === undefined) a.atf_status = 'nao_precisa';
    if (a.turno === undefined) a.turno = 'manha';
    if (a.lista_escola === undefined) a.lista_escola = false;
    if (a.pca_count === undefined) a.pca_count = 0;
    if (a.apoio_count === undefined) a.apoio_count = 0;
    if (a.pcd_students === undefined) a.pcd_students = [];
    if (a.passengers === undefined) a.passengers = [];
    if (a.recurrence_group_id === undefined) a.recurrence_group_id = null;
    if (a.publico_alvo === undefined) a.publico_alvo = null;
    if (a.setor_pedagogico_atual === undefined) a.setor_pedagogico_atual = setorPadraoPara(a.publico_alvo);
    if (a.doc_status === undefined) a.doc_status = 'nao_enviado';
    if (a.doc_drive_file_id === undefined) a.doc_drive_file_id = null;
    if (a.doc_drive_url === undefined) a.doc_drive_url = null;
    if (a.doc_filename === undefined) a.doc_filename = null;
    if (a.doc_uploaded_at === undefined) a.doc_uploaded_at = null;
    if (a.doc_parecer_comentario === undefined) a.doc_parecer_comentario = null;
    if (a.doc_parecer_por === undefined) a.doc_parecer_por = null;
    if (a.doc_parecer_em === undefined) a.doc_parecer_em = null;
    if (a.listagem_status === undefined) a.listagem_status = 'nao_enviada';
    if (a.listagem_enviada_em === undefined) a.listagem_enviada_em = null;
    if (a.listagem_parecer_por === undefined) a.listagem_parecer_por = null;
    if (a.listagem_parecer_em === undefined) a.listagem_parecer_em = null;
    if (a.listagem_parecer_comentario === undefined) a.listagem_parecer_comentario = null;
    if (a.listagem_files === undefined) a.listagem_files = [];
  });
}

// ============ ÍCONES (tolera falha de rede ao carregar a lib externa) ============
function decorateActionButtons() {
  document.querySelectorAll('button').forEach((button) => {
    if (button.dataset.iconified || button.querySelector('i, svg')) return;
    const label = (button.textContent || '').trim().toLowerCase();
    const icon = /cancelar|voltar|fechar/.test(label) ? ['circle-x', 'text-slate-500']
      : /excluir|bloquear|recusa|rejeitar/.test(label) ? ['trash-2', 'text-rose-500']
      : /salvar|confirmar|aceitar|reativar/.test(label) ? ['circle-check', 'text-emerald-300']
      : /adicionar|novo|criar/.test(label) ? ['circle-plus', 'text-emerald-200']
      : /editar/.test(label) ? ['pencil', 'text-sky-500']
      : /atualizar/.test(label) ? ['refresh-cw', 'text-sky-500']
      : /limpar/.test(label) ? ['filter-x', 'text-slate-400']
      : /pdf|excel|exportar/.test(label) ? ['file-down', 'text-indigo-300']
      : /sair/.test(label) ? ['log-out', 'text-emerald-300'] : null;
    if (!icon) return;
    button.dataset.iconified = '1';
    button.classList.add('inline-flex', 'items-center', 'gap-1.5');
    button.insertAdjacentHTML('afterbegin', `<i data-lucide="${icon[0]}" class="w-4 h-4 shrink-0 ${icon[1]}"></i>`);
  });
}

function safeIcons() {
  try {
    decorateActionButtons();
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
  } catch (e) {
    console.warn('⚠️ Ícones (lucide) não carregaram:', e);
  }
}

// ============ INICIALIZAÇÃO ============
// Agora são duas páginas de verdade: index.html (login) e app.html (sistema).
// O <body data-page="login"|"app"> diz pra este mesmo app.js (compartilhado pelas
// duas páginas) qual das duas inicializações rodar.
document.addEventListener('DOMContentLoaded', () => {
  safeIcons();
  initSupabase();
  maybeRegisterMotoristaPwa();

  const page = document.body.dataset.page;
  if (page === 'login') {
    initLoginPage();
  } else if (page === 'app') {
    initAppPage();
  }
});

// ============ APP INSTALÁVEL DO MOTORISTA (PWA/atalho, ver motorista.html) ============
// Só a página motorista.html (data-pwa="motorista") registra este Service Worker -
// index.html/app.html continuam sem nenhum (ver bloco no fim deste arquivo, que
// desregistra qualquer Service Worker antigo - e propositalmente poupa este aqui).
function maybeRegisterMotoristaPwa() {
  if (document.body.dataset.pwa !== 'motorista') return;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw-motorista.js').catch((e) => {
    console.warn('⚠️ Não foi possível registrar o Service Worker do app do Motorista:', e);
  });
}

async function initLoginPage() {
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('forgotPasswordBtn')?.addEventListener('click', requestOwnPasswordReset);

  if (new URLSearchParams(window.location.search).get('bloqueado') === '1') {
    toast('❌ Sua conta foi bloqueada pelo administrador. Procure o administrador do sistema.', true);
    history.replaceState(null, '', 'index.html');
  }

  if (!sb) {
    document.getElementById('demoNotice').classList.remove('hidden');
    // Se já existia uma sessão demo ativa (ex: usuário voltou pro index.html sem sair),
    // pula direto pra página do sistema em vez de pedir login de novo.
    if (sessionStorage.getItem('demoUser')) {
      window.location.href = 'app.html';
    }
    return;
  }

  // Supabase configurado: se já existe uma sessão válida (usuário não saiu),
  // vai direto pra página do sistema em vez de mostrar o login de novo.
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) window.location.href = 'app.html';
  } catch (err) {
    console.warn('Erro ao checar sessão existente:', err);
  }
}

async function initAppPage() {
  if (!sb) {
    const saved = sessionStorage.getItem('demoUser');
    if (!saved) {
      window.location.href = 'index.html';
      return;
    }
    currentUser = JSON.parse(saved);
    loadDemoData();
    // Se a conta foi bloqueada por um admin depois que esta sessão demo já tinha sido
    // aberta (ex: em outra aba), derruba a sessão local também, não só o login novo.
    const profile = demoProfiles.find((p) => p.id === currentUser.id);
    if (profile && profile.active === false) {
      sessionStorage.removeItem('demoUser');
      window.location.href = 'index.html?bloqueado=1';
      return;
    }
    await enterApp();
    return;
  }

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = 'index.html';
      return;
    }
    currentUser = session.user;
    await loadUserProfile();
    await enterApp();
  } catch (err) {
    console.error('Erro ao carregar sessão/perfil na página do sistema:', err);
    window.location.href = err && err.blocked ? 'index.html?bloqueado=1' : 'index.html';
  }
}

// ============ SUPABASE ============
function initSupabase() {
  const url = localStorage.getItem('sb_url') || DEFAULT_SUPABASE_URL;
  const key = localStorage.getItem('sb_key') || DEFAULT_SUPABASE_ANON_KEY;

  if (url && key) {
    try {
      sb = window.supabase.createClient(url, key);
      console.log('✅ Supabase conectado');
    } catch (e) {
      console.warn('⚠️ Erro ao conectar Supabase:', e);
    }
  } else {
    console.log('ℹ️ Supabase não configurado - usando modo demo');
  }
}

function togglePasswordVisibility() {
  const input = document.getElementById('loginPassword');
  const icon = document.getElementById('togglePasswordIcon');
  const btn = document.getElementById('togglePasswordBtn');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  if (icon) icon.textContent = showing ? '👁️' : '🙈';
  if (btn) btn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
}

// ============ AUTENTICAÇÃO ============
async function loadUserProfile() {
  if (!sb || !currentUser) return;

  let { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();

  if (!data) {
    // Criação controlada no banco: o navegador não pode escolher papel, unidade ou motorista.
    const { data: created } = await sb
      .rpc('ensure_own_profile')
      .single();
    data = created;
  }

  if (data && data.active === false) {
    // Conta bloqueada pelo admin na tela Usuários - encerra a sessão do Supabase também,
    // não só o estado local, senão a pessoa continuaria "logada de verdade" só sem UI.
    await sb.auth.signOut();
    const err = new Error('Sua conta foi bloqueada pelo administrador. Procure o administrador do sistema.');
    err.blocked = true;
    throw err;
  }

  if (data) {
    currentUser.role = data.role || 'escola';
    currentUser.schoolId = data.school_id || null;
    currentUser.driverId = data.driver_id || null;
    currentUser.setorPedagogico = data.setor_pedagogico || null;
    currentUser.accessProfileId = data.access_profile_id || null;
    currentUser.user_metadata = { full_name: data.full_name };
  } else {
    currentUser.role = 'escola';
  }
}

// ============ LOGIN ============
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  const btn = document.getElementById('loginSubmitBtn');
  const btnTextoOriginal = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }

  try {
    if (sb) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        toast('❌ ' + error.message, true);
        return;
      }
      currentUser = data.user;
      if (btn) btn.textContent = 'Carregando perfil...';
      await loadUserProfile();
    } else {
      // Modo demo: carrega os dados salvos (inclusive perfis que um admin já tenha
      // editado pela tela "Usuários") antes de decidir o perfil de quem está logando.
      loadDemoData();
      const emailLower = email.toLowerCase();
      let profile = demoProfiles.find((p) => p.email.toLowerCase() === emailLower);
      if (!profile) {
        // "primeiro login" simulado: cria o perfil com papel padrão detectado pelo
        // e-mail (igual ao Supabase real, que sempre cria com papel "escola").
        const role = detectRole(email);
        profile = {
          id: 'demo-' + Date.now(),
          email,
          full_name: email.split('@')[0],
          role,
          school_id: role === 'escola' ? DEMO_SCHOOLS[0].id : null,
          driver_id: role === 'motorista' ? DEMO_DRIVERS[0].id : null,
          setor_pedagogico: null,
          active: true,
        };
        demoProfiles.push(profile);
        saveDemoData();
      }
      if (profile.active === false) {
        toast('❌ Sua conta foi bloqueada pelo administrador. Procure o administrador do sistema.', true);
        return;
      }
      currentUser = {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        schoolId: profile.school_id || null,
        driverId: profile.driver_id || null,
        setorPedagogico: profile.setor_pedagogico || null,
        accessProfileId: profile.access_profile_id || null,
        user_metadata: { full_name: profile.full_name },
      };
      // Como o modo demo não usa sessão real do Supabase, guardamos o usuário aqui
      // pra sobreviver à troca de página (login.html -> app.html).
      sessionStorage.setItem('demoUser', JSON.stringify(currentUser));
    }

    // Login e carregamento do perfil confirmados: agora sim navega pra página
    // separada do sistema. É uma troca de página de verdade (nova URL), não
    // só uma div escondida/mostrada.
    window.location.href = 'app.html';
  } catch (err) {
    console.error('Erro no login:', err);
    if (err && err.blocked) {
      toast('❌ ' + err.message, true);
    } else {
      toast('❌ Não foi possível entrar: ' + (err && err.message ? err.message : err), true);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btnTextoOriginal || 'Entrar no Sistema'; }
  }
}

function detectRole(email) {
  const lower = email.toLowerCase();
  if (lower.includes('admin')) return 'admin';
  if (lower.includes('pedagogia')) return 'pedagogia';
  if (lower.includes('motorista')) return 'motorista';
  if (lower.includes('escola')) return 'escola';
  return 'admin';
}

async function enterApp() {
  await loadAccessProfiles();
  const perfilAdministrativo = currentUser?.accessProfileId ? accessProfiles.find((p) => p.id === currentUser.accessProfileId) : null;
  document.getElementById('userRole').textContent = perfilAdministrativo?.name || ROLE_LABELS[currentUser.role] || currentUser.role;
  const nomeUsuario = currentUser?.user_metadata?.full_name || currentUser?.full_name || (currentUser?.email ? currentUser.email.split('@')[0] : 'Usuário');
  document.getElementById('userInfo').textContent = nomeUsuario;
  const topUserName = document.getElementById('topUserName');
  if (topUserName) topUserName.textContent = nomeUsuario;
  const driverHeaderName = document.getElementById('driverHeaderName');
  if (driverHeaderName) driverHeaderName.textContent = `Motorista: ${nomeUsuario}`;

  applyRoleUI(currentUser.role);

  await Promise.all([loadSchools(), loadVehicles(), loadDrivers(), loadProfiles(), loadCooperativas(), loadAppSettings()]);
  await loadAgenda();
  await loadKmLogs();
  await loadNotifications();
  if (sb) window.setInterval(loadNotifications, 60000);

  showScreen(defaultScreenForCurrentUser());
}

function permissionForScreen(screen) {
  if (currentUser?.role !== 'operacional') return null;
  return accessProfilePermissions.find((p) => p.access_profile_id === currentUser.accessProfileId && p.screen_key === screen) || null;
}
function canViewScreen(screen) {
  if (!currentUser) return false;
  if (currentUser.role === 'operacional') return !!permissionForScreen(screen)?.can_view;
  return (SCREEN_ROLES[screen] || []).includes(currentUser.role);
}
function canEditScreen(screen) {
  if (!currentUser) return false;
  if (currentUser.role === 'operacional') return !!permissionForScreen(screen)?.can_edit;
  return currentUser.role === 'admin';
}
function defaultScreenForCurrentUser() {
  if (currentUser?.role !== 'operacional') return ROLE_DEFAULT_SCREEN[currentUser?.role] || 'dashboard';
  return ACCESS_SCREEN_CATALOG.find((screen) => canViewScreen(screen.key))?.key || 'dashboard';
}

async function loadAccessProfiles() {
  if (!sb) { accessProfiles = []; accessProfilePermissions = []; return; }
  const [profilesResult, permissionsResult] = await Promise.all([
    sb.from('access_profiles').select('*').order('name'),
    sb.from('access_profile_permissions').select('*'),
  ]);
  accessProfiles = profilesResult.data || [];
  accessProfilePermissions = permissionsResult.data || [];
}

function applyRoleUI(role) {
  document.body.classList.toggle('pedagogia-compact', role === 'pedagogia');
  document.body.classList.toggle('driver-mobile', role === 'motorista');
  document.getElementById('driverHeaderName')?.classList.toggle('hidden', role !== 'motorista');
  document.querySelectorAll('.sidebar-link, .top-nav-link').forEach((a) => {
    a.hidden = !canViewScreen(a.dataset.screen);
  });
  // Atalho de odômetro na lateral (não é um item de navegação de tela, por isso não usa
  // a classe .sidebar-link - evita ser tratado como uma tela navegável em outro lugar).
  const btnKmSidebar = document.getElementById('btnRegistrarOdometroSidebar');
  if (btnKmSidebar) btnKmSidebar.hidden = !['admin','motorista'].includes(role);
  document.getElementById('navAgendaLabel').textContent = role === 'motorista' ? 'Minhas Viagens' : 'Agenda';
  const navAgendaTopLabel = document.getElementById('navAgendaTopLabel');
  if (navAgendaTopLabel) navAgendaTopLabel.textContent = role === 'motorista' ? 'Hoje' : 'Agenda';
  const nomeTopo = document.getElementById('topUserName');
  if (nomeTopo) {
    nomeTopo.classList.toggle('text-xs', role === 'motorista');
    nomeTopo.classList.toggle('text-sm', role !== 'motorista');
  }
  const perfilNoTitulo = document.getElementById('pageRoleName');
  if (perfilNoTitulo) {
    const exibir = role === 'admin' || role === 'pedagogia';
    perfilNoTitulo.classList.toggle('hidden', !exibir);
    perfilNoTitulo.textContent = exibir ? (ROLE_LABELS[role] || role) : '';
  }
  updateAdministrativeActionButtons();
}

function updateAdministrativeActionButtons() {
  const kmAdmin = currentUser?.role === 'admin' || (currentUser?.role === 'operacional' && canViewScreen('km'));
  const vehicleEdit = currentUser?.role === 'admin' || (currentUser?.role === 'operacional' && canEditScreen('veiculos'));
  const driverEdit = currentUser?.role === 'admin' || (currentUser?.role === 'operacional' && canEditScreen('motoristas'));
  document.getElementById('btnNovoVeiculo')?.classList.toggle('hidden', !vehicleEdit);
  document.getElementById('btnNovoMotorista')?.classList.toggle('hidden', !driverEdit);
  document.getElementById('btnNovoKmAdmin')?.classList.toggle('hidden', !(kmAdmin && canEditScreen('km')));
}

async function logout() {
  try {
    if (sb) await sb.auth.signOut();
  } catch (err) {
    console.warn('Erro ao encerrar sessão no Supabase (seguindo com o logout local):', err);
  }
  currentUser = null;
  sessionStorage.removeItem('demoUser');
  // Volta pra página de login separada (URL diferente, não é só trocar de div).
  window.location.href = 'index.html';
}

// ============ VISIBILIDADE POR PERFIL (espelha as políticas RLS) ============
function getVisibleAgenda() {
  if (!currentUser) return [];
  if (currentUser.role === 'admin' || currentUser.role === 'pedagogia') return agenda;
  if (currentUser.role === 'escola') return agenda.filter((a) => a.school_id === currentUser.schoolId);
  if (currentUser.role === 'motorista') return agenda.filter((a) => (a.driver_ids || []).includes(currentUser.driverId));
  if (currentUser.role === 'operacional') return canViewScreen('agenda') || canViewScreen('dashboard') || canViewScreen('relatorios') || canViewScreen('validacoes') ? agenda : [];
  return [];
}

// ============ PERFIS (pra mostrar "validador (primeiro nome)" etc.) ============
async function loadProfiles() {
  if (sb) {
    const { data } = await sb.from('profiles').select('id, full_name, email, phone, role, school_id, driver_id, access_profile_id, active');
    profilesById = {};
    allProfiles = data || [];
    (data || []).forEach((p) => { profilesById[p.id] = p; });
  } else if (currentUser) {
    // Modo demo não tem outros perfis "reais" pra consultar - registra pelo menos
    // o usuário atual, então se ele mesmo validar algo o nome aparece certinho.
    profilesById[currentUser.id] = { id: currentUser.id, full_name: currentUser.user_metadata?.full_name, email: currentUser.email, phone: null };
  }
}

// ============ USUÁRIOS (só admin - editar perfil/unidade/motorista de cada login) ============
// Obs: esta tela só EDITA logins que já existem em "profiles" (ou seja, que já acessaram
// o sistema pelo menos uma vez - a linha é criada sozinha no primeiro login, com papel
// "escola" por padrão). Criar um login novo do zero (e-mail + senha) ainda depende do
// painel do Supabase (Authentication > Add user) ou de uma automação futura.
async function loadAllProfiles() {
  if (sb) {
    const { data, error } = await sb.from('profiles').select('*').order('email');
    if (error) { toast('❌ ' + error.message, true); return; }
    allProfiles = data || [];
  } else {
    allProfiles = demoProfiles;
  }
}

function openUsuariosScreen() {
  loadAllProfiles().then(renderUsuarios);
}

function renderUsuarios() {
  const tbody = document.getElementById('usuariosTable');
  if (!tbody) return;
  if (allProfiles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-500 text-sm">Nenhum usuário encontrado</td></tr>';
    return;
  }
  tbody.innerHTML = allProfiles
    .slice()
    .sort((a, b) => (a.email || '').localeCompare(b.email || ''))
    .map((p) => {
      let vinculo = '—';
      if (p.role === 'escola') vinculo = schoolName(p.school_id) || '<span class="text-amber-600">sem unidade definida</span>';
      else if (p.role === 'motorista') {
        const d = drivers.find((x) => x.id === p.driver_id);
        vinculo = d ? d.name : '<span class="text-amber-600">sem motorista vinculado</span>';
      } else if (p.role === 'pedagogia') {
        vinculo = SETOR_PEDAGOGICO_LABELS[p.setor_pedagogico] || '<span class="text-amber-600">sem setor definido</span>';
      } else if (p.role === 'operacional') {
        vinculo = accessProfiles.find((x) => x.id === p.access_profile_id)?.name || '<span class="text-amber-600">sem perfil definido</span>';
      }
      const statusBadge = p.active === false
        ? '<span class="bg-slate-100 text-slate-500 px-2 py-1 rounded text-xs font-medium">Bloqueado</span>'
        : '<span class="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-medium">Ativo</span>';
      const toggleBtn = p.active === false
        ? `<button onclick="toggleUserActive('${p.id}')" class="ml-2 text-xs text-emerald-600 hover:text-emerald-800">Desbloquear</button>`
        : `<button onclick="toggleUserActive('${p.id}')" class="ml-2 text-xs text-red-600 hover:text-red-800">Bloquear</button>`;
      return `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-sm font-medium">${p.full_name || '-'}</td>
      <td class="px-4 py-3 text-sm">${p.email}</td>
      <td class="px-4 py-3 text-sm">${p.role === 'motorista' ? '—' : (p.phone || '—')}</td>
      <td class="px-4 py-3 text-sm">${p.role === 'operacional' ? 'Administrativo' : (ROLE_LABELS[p.role] || p.role)}</td>
      <td class="px-4 py-3 text-sm">${vinculo}</td>
      <td class="px-4 py-3 text-sm whitespace-nowrap">${statusBadge}<button onclick="openUserModal('${p.id}')" class="ml-2 text-xs text-emerald-600 hover:text-emerald-800">Editar</button><button onclick="sendPasswordResetForUser('${p.id}')" class="ml-2 text-xs text-blue-600 hover:text-blue-800">Redefinir senha</button>${toggleBtn}</td>
    </tr>`;
    }).join('');
}

// Bloquear = a conta continua existindo (e-mail/senha, histórico de solicitações etc.)
// mas a pessoa não consegue mais entrar no sistema - é revertível (Desbloquear), ao
// contrário de excluir de verdade (que a Supabase recusaria de qualquer forma: nada
// menos que 10 colunas em excursions/histórico apontam pra profiles sem "on delete
// cascade", então excluir um perfil quebraria o histórico de viagens que ele
// aprovou/criou/comentou - por isso este app usa bloqueio em vez de exclusão aqui).
async function toggleUserActive(id) {
  if (id === currentUser.id) { toast('⚠️ Você não pode bloquear a própria conta.', true); return; }
  const p = allProfiles.find((x) => x.id === id);
  if (!p) return;
  const novoActive = p.active === false; // true = vai desbloquear; false = vai bloquear
  const patch = { active: novoActive };
  if (sb) {
    const { error } = await sb.from('profiles').update(patch).eq('id', id);
    if (error) { toast('❌ ' + error.message, true); return; }
  } else {
    const dp = demoProfiles.find((x) => x.id === id);
    if (dp) Object.assign(dp, patch);
    saveDemoData();
  }
  await loadAllProfiles();
  renderUsuarios();
  toast(novoActive ? '✅ Usuário desbloqueado - já pode entrar no sistema de novo.' : '🚫 Usuário bloqueado - não vai mais conseguir entrar no sistema.');
}

function openUserModal(id) {
  editUserId = id;
  const p = allProfiles.find((x) => x.id === id);
  if (!p) return;
  document.getElementById('userModalEmail').textContent = p.email;
  document.getElementById('newUserNome').value = p.full_name || '';
  document.getElementById('newUserTelefone').value = p.phone || '';
  document.getElementById('newUserRole').value = p.role || 'escola';
  fillAccessProfileSelect('newUserAccessProfileId', p.access_profile_id || '');

  const schoolSel = document.getElementById('newUserSchoolId');
  schoolSel.innerHTML = '<option value="">— selecione —</option>' + schools.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  schoolSel.value = p.school_id || '';

  const driverSel = document.getElementById('newUserDriverId');
  driverSel.innerHTML = '<option value="">— selecione —</option>' + drivers.map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
  driverSel.value = p.driver_id || '';

  const setorSel = document.getElementById('newUserSetorPedagogico');
  setorSel.value = p.setor_pedagogico || '';

  onUserRoleChange();
  document.getElementById('userModal').classList.remove('hidden');
}

function onUserRoleChange() {
  const role = document.getElementById('newUserRole').value;
  document.getElementById('userTelefoneWrap').classList.toggle('hidden', role === 'motorista');
  document.getElementById('userEscolaWrap').classList.toggle('hidden', role !== 'escola');
  document.getElementById('userMotoristaWrap').classList.toggle('hidden', role !== 'motorista');
  document.getElementById('userSetorWrap').classList.toggle('hidden', role !== 'pedagogia');
  document.getElementById('userAccessProfileWrap').classList.toggle('hidden', role !== 'operacional');
}

function closeUserModal() { document.getElementById('userModal').classList.add('hidden'); editUserId = null; }

async function confirmSaveUser() {
  if (!editUserId) return;
  const role = document.getElementById('newUserRole').value;
  const patch = {
    full_name: document.getElementById('newUserNome').value.trim() || null,
    phone: role === 'motorista' ? null : (document.getElementById('newUserTelefone').value.trim() || null),
    role,
    school_id: role === 'escola' ? (document.getElementById('newUserSchoolId').value || null) : null,
    driver_id: role === 'motorista' ? (document.getElementById('newUserDriverId').value || null) : null,
    setor_pedagogico: role === 'pedagogia' ? (document.getElementById('newUserSetorPedagogico').value || null) : null,
    access_profile_id: role === 'operacional' ? (document.getElementById('newUserAccessProfileId').value || null) : null,
  };
  if (role === 'escola' && !patch.school_id) { toast('⚠️ Selecione a unidade escolar deste usuário.', true); return; }
  if (role === 'motorista' && !patch.driver_id) { toast('⚠️ Selecione o motorista vinculado a este usuário.', true); return; }
  if (role === 'pedagogia' && !patch.setor_pedagogico) { toast('⚠️ Selecione o setor pedagógico deste usuário.', true); return; }
  if (role === 'operacional' && !patch.access_profile_id) { toast('⚠️ Selecione o perfil administrativo deste usuário.', true); return; }

  if (sb) {
    const { error } = await sb.from('profiles').update(patch).eq('id', editUserId);
    if (error) { toast('❌ ' + error.message, true); return; }
  } else {
    const p = demoProfiles.find((x) => x.id === editUserId);
    if (p) Object.assign(p, patch);
    saveDemoData();
  }
  toast('✅ Usuário atualizado.');
  closeUserModal();
  await loadAllProfiles();
  renderUsuarios();
}

// ---- Criar usuário novo (login + perfil de uma vez, via Edge Function) ----
function openCreateUserModal() {
  document.getElementById('createUserNome').value = '';
  document.getElementById('createUserEmail').value = '';
  document.getElementById('createUserSenha').value = '';
  document.getElementById('createUserTelefone').value = '';
  document.getElementById('createUserRole').value = 'escola';

  const schoolSel = document.getElementById('createUserSchoolId');
  schoolSel.innerHTML = '<option value="">— selecione —</option>' + schools.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  const driverSel = document.getElementById('createUserDriverId');
  driverSel.innerHTML = '<option value="">— selecione —</option>' + drivers.map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
  document.getElementById('createUserSetorPedagogico').value = '';
  fillAccessProfileSelect('createUserAccessProfileId');

  document.getElementById('createUserUnavailableNotice').classList.toggle('hidden', !!sb);
  onCreateUserRoleChange();
  document.getElementById('createUserModal').classList.remove('hidden');
}
function closeCreateUserModal() { document.getElementById('createUserModal').classList.add('hidden'); }

function onCreateUserRoleChange() {
  const role = document.getElementById('createUserRole').value;
  document.getElementById('createUserTelefoneWrap').classList.toggle('hidden', role === 'motorista');
  document.getElementById('createUserEscolaWrap').classList.toggle('hidden', role !== 'escola');
  document.getElementById('createUserMotoristaWrap').classList.toggle('hidden', role !== 'motorista');
  document.getElementById('createUserSetorWrap').classList.toggle('hidden', role !== 'pedagogia');
  document.getElementById('createUserAccessProfileWrap').classList.toggle('hidden', role !== 'operacional');
}

async function confirmCreateUser() {
  if (!sb) {
    toast('⚠️ Criar usuário novo só funciona com o Supabase configurado (o modo demonstração não tem autenticação de verdade).', true);
    return;
  }
  const full_name = document.getElementById('createUserNome').value.trim();
  const email = document.getElementById('createUserEmail').value.trim();
  const password = document.getElementById('createUserSenha').value;
  const role = document.getElementById('createUserRole').value;
  const phone = role === 'motorista' ? null : (document.getElementById('createUserTelefone').value.trim() || null);
  const school_id = role === 'escola' ? (document.getElementById('createUserSchoolId').value || null) : null;
  const driver_id = role === 'motorista' ? (document.getElementById('createUserDriverId').value || null) : null;
  const setor_pedagogico = role === 'pedagogia' ? (document.getElementById('createUserSetorPedagogico').value || null) : null;
  const access_profile_id = role === 'operacional' ? (document.getElementById('createUserAccessProfileId').value || null) : null;

  if (!email || !password) { toast('⚠️ Informe e-mail e senha.', true); return; }
  if (password.length < 6) { toast('⚠️ A senha precisa ter pelo menos 6 caracteres.', true); return; }
  if (role === 'escola' && !school_id) { toast('⚠️ Selecione a unidade escolar deste usuário.', true); return; }
  if (role === 'motorista' && !driver_id) { toast('⚠️ Selecione o motorista vinculado a este usuário.', true); return; }
  if (role === 'pedagogia' && !setor_pedagogico) { toast('⚠️ Selecione o setor pedagógico deste usuário.', true); return; }
  if (role === 'operacional' && !access_profile_id) { toast('⚠️ Selecione o perfil administrativo deste usuário.', true); return; }

  try {
    const { data: { session } } = await sb.auth.getSession();
    const url = localStorage.getItem('sb_url') || DEFAULT_SUPABASE_URL;
    const anonKey = localStorage.getItem('sb_key') || DEFAULT_SUPABASE_ANON_KEY;
    const resp = await fetch(`${url}/functions/v1/admin-create-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session ? session.access_token : anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ email, password, full_name: full_name || null, phone, role, school_id, driver_id, setor_pedagogico, access_profile_id }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.error) {
      toast('❌ ' + (json.error || `Erro ao criar usuário (HTTP ${resp.status}). A Edge Function "admin-create-user" está publicada no seu projeto?`), true);
      return;
    }
    toast('✅ Usuário criado! Avise a pessoa da senha temporária por fora do sistema.');
    closeCreateUserModal();
    await loadAllProfiles();
    renderUsuarios();
  } catch (err) {
    toast('❌ Não foi possível chamar a função de criação de usuário: ' + (err && err.message ? err.message : err), true);
  }
}

function fillAccessProfileSelect(id, selected = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '<option value="">— selecione —</option>' + accessProfiles.filter((p) => p.active !== false).map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  el.value = selected;
}

function renderAccessProfiles() {
  const wrap = document.getElementById('accessProfilesList');
  if (!wrap) return;
  if (!accessProfiles.length) { wrap.innerHTML = '<p class="text-sm text-slate-500 py-5 text-center">Nenhum perfil administrativo criado.</p>'; return; }
  wrap.innerHTML = accessProfiles.map((profile) => {
    const perms = accessProfilePermissions.filter((p) => p.access_profile_id === profile.id && p.can_view);
    const labels = perms.map((p) => `${ACCESS_SCREEN_CATALOG.find((s) => s.key === p.screen_key)?.label || p.screen_key}${p.can_edit ? ' · editar' : ' · consultar'}`);
    return `<div class="border rounded-xl p-4 flex items-start justify-between gap-3"><div><strong>${escapeHtml(profile.name)}</strong><p class="text-xs text-slate-500 mt-1">${labels.length ? labels.map(escapeHtml).join(' &nbsp;•&nbsp; ') : 'Sem telas liberadas'}</p></div><button onclick="openAccessProfileModal('${profile.id}')" class="text-sm text-emerald-700 font-medium">Editar</button></div>`;
  }).join('');
}

function openAccessProfileModal(id = null) {
  editAccessProfileId = id;
  const profile = accessProfiles.find((p) => p.id === id);
  document.getElementById('accessProfileModalTitle').textContent = profile ? 'Editar perfil administrativo' : 'Novo perfil administrativo';
  document.getElementById('accessProfileName').value = profile?.name || '';
  const existing = accessProfilePermissions.filter((p) => p.access_profile_id === id);
  document.getElementById('accessPermissionsEditor').innerHTML = ACCESS_SCREEN_CATALOG.map((screen) => {
    const permission = existing.find((p) => p.screen_key === screen.key);
    return `<div class="border rounded-lg p-3 flex items-center gap-3"><label class="flex items-center gap-2 flex-1 text-sm font-medium"><input type="checkbox" data-access-view="${screen.key}" ${permission?.can_view ? 'checked' : ''}> ${screen.label}</label>${screen.editable ? `<label class="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" data-access-edit="${screen.key}" ${permission?.can_edit ? 'checked' : ''}> Pode editar</label>` : '<span class="text-xs text-slate-400">Consulta</span>'}</div>`;
  }).join('');
  document.getElementById('accessProfileModal').classList.remove('hidden');
}
function closeAccessProfileModal() { document.getElementById('accessProfileModal').classList.add('hidden'); editAccessProfileId = null; }

async function saveAccessProfile() {
  const name = document.getElementById('accessProfileName').value.trim();
  if (!name) { toast('⚠️ Informe o nome do perfil.', true); return; }
  const permissions = ACCESS_SCREEN_CATALOG.map((screen) => {
    const can_view = !!document.querySelector(`[data-access-view="${screen.key}"]`)?.checked;
    return { screen_key: screen.key, can_view, can_edit: can_view && !!document.querySelector(`[data-access-edit="${screen.key}"]`)?.checked };
  });
  if (!permissions.some((p) => p.can_view)) { toast('⚠️ Libere ao menos uma tela.', true); return; }
  if (!sb) { toast('⚠️ Esta configuração precisa do Supabase.', true); return; }
  let profileId = editAccessProfileId;
  const profileResult = profileId
    ? await sb.from('access_profiles').update({ name }).eq('id', profileId).select().single()
    : await sb.from('access_profiles').insert({ name }).select().single();
  if (profileResult.error) { toast('❌ ' + profileResult.error.message, true); return; }
  profileId = profileResult.data.id;
  const deleteResult = await sb.from('access_profile_permissions').delete().eq('access_profile_id', profileId);
  if (deleteResult.error) { toast('❌ ' + deleteResult.error.message, true); return; }
  const insertResult = await sb.from('access_profile_permissions').insert(permissions.map((p) => ({ ...p, access_profile_id: profileId })));
  if (insertResult.error) { toast('❌ ' + insertResult.error.message, true); return; }
  await loadAccessProfiles(); renderAccessProfiles(); closeAccessProfileModal(); toast('✅ Perfil administrativo salvo.');
}

function firstNameOf(text) {
  if (!text) return '';
  return text.trim().split(' ')[0];
}

function validatorFirstName(id) {
  if (!id) return '—';
  const p = profilesById[id];
  if (!p) return '—';
  return firstNameOf(p.full_name || p.email) || '—';
}

// Nome completo de quem validou/deu parecer - usado em toda tela que mostra uma
// aprovação/parecer pedagógico (Agenda, Validações), pra deixar claro e sem ambiguidade
// QUEM deu o deferimento (antes só aparecia o primeiro nome).
function validatorFullName(id) {
  if (!id) return '—';
  const p = profilesById[id];
  if (!p) return '—';
  return p.full_name || p.email || '—';
}

// ============ NAVEGAÇÃO ============
// Lateral no celular: gaveta que abre por cima do conteúdo (fechada por padrão) via a
// classe .sidebar-open (CSS escrito à mão em app.html, não Tailwind - veja o comentário
// lá) - a partir do tablet/desktop essas regras de CSS ignoram a classe e a lateral fica
// sempre visível do lado, exatamente como era antes dessa mudança.
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('sidebar-open');
  document.getElementById('sidebarOverlay').classList.toggle('sidebar-open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('sidebar-open');
  document.getElementById('sidebarOverlay').classList.remove('sidebar-open');
}


// ============ NOTIFICAÇÕES ============
async function loadNotifications() {
  if (!currentUser || !sb) { notifications = []; renderNotificationBell(); return; }
  const { data, error } = await sb.from('notifications')
    .select('*').eq('user_id', currentUser.id)
    .order('created_at', { ascending: false }).limit(30);
  notifications = error ? [] : (data || []);
  const unread = notifications.filter((n) => !n.read_at).length;
  if (unreadNotificationsSeen !== null && unread > unreadNotificationsSeen) playNotificationSound();
  unreadNotificationsSeen = unread;
  renderNotificationBell();
}

async function loadValidationConfig() {
  if (!sb) return;
  const [setores, publicos, vinculos] = await Promise.all([
    sb.from('validation_sectors').select('*').order('name'),
    sb.from('validation_targets').select('*').order('name'),
    sb.from('validator_sector_assignments').select('*'),
  ]);
  if (!setores.error) validationSectors = setores.data || [];
  if (!publicos.error) validationTargets = publicos.data || [];
  if (!vinculos.error) validatorSectorAssignments = vinculos.data || [];
}

async function openValidadoresScreen() {
  if (currentUser?.role !== 'admin') return;
  await Promise.all([loadValidationConfig(), loadAllProfiles()]);
  renderValidadores();
}

function renderValidadores() {
  const setorSelect = document.getElementById('novoPublicoSetor');
  if (!setorSelect) return;
  setorSelect.innerHTML = '<option value="">— setor responsável —</option>' + validationSectors.filter((s) => s.active !== false).map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  document.getElementById('listaSetoresValidacao').innerHTML = validationSectors.length ? validationSectors.map((s) => `<div class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span>${escapeHtml(s.name)}</span><button onclick="arquivarSetorValidacao('${s.id}')" class="text-xs text-red-600">Remover</button></div>`).join('') : '<p class="text-sm text-slate-500">Execute a migration 017 para cadastrar setores.</p>';
  document.getElementById('listaPublicosValidacao').innerHTML = validationTargets.length ? validationTargets.map((t) => { const setor = validationSectors.find((s) => s.id === t.default_sector_id); return `<div class="rounded-lg bg-slate-50 px-3 py-2 text-sm"><strong>${escapeHtml(t.name)}</strong><div class="text-xs text-slate-500">Validação inicial: ${escapeHtml(setor?.name || 'não definida')}</div></div>`; }).join('') : '<p class="text-sm text-slate-500">Nenhum público-alvo cadastrado.</p>';
  const validadores = allProfiles.filter((p) => p.role === 'pedagogia' && p.active !== false);
  document.getElementById('listaValidadores').innerHTML = validadores.length ? validadores.map((p) => {
    const permitidos = new Set(validatorSectorAssignments.filter((v) => v.profile_id === p.id).map((v) => v.sector_id));
    return `<div class="border rounded-xl p-4"><strong>${escapeHtml(p.full_name || p.email)}</strong><div class="mt-2 space-y-1">${validationSectors.filter((s) => s.active !== false).map((s) => `<label class="flex gap-2 text-sm"><input type="checkbox" ${permitidos.has(s.id) ? 'checked' : ''} onchange="alterarSetoresValidador('${p.id}')" value="${s.id}" data-validator="${p.id}"> ${escapeHtml(s.name)}</label>`).join('')}</div></div>`;
  }).join('') : '<p class="text-sm text-slate-500">Crie um usuário com perfil Pedagogia para vinculá-lo como validador.</p>';
}

async function criarSetorValidacao() {
  const input = document.getElementById('novoSetorValidacao'); const name = input.value.trim();
  if (!name) { toast('⚠️ Informe o nome do setor.', true); return; }
  const { error } = await sb.from('validation_sectors').insert({ name });
  if (error) { toast('❌ ' + error.message, true); return; }
  input.value = ''; await loadValidationConfig(); renderValidadores();
}
async function arquivarSetorValidacao(id) {
  if (!window.confirm('Remover este setor do cadastro? Os históricos não serão apagados.')) return;
  const { error } = await sb.from('validation_sectors').update({ active:false }).eq('id', id);
  if (error) { toast('❌ ' + error.message, true); return; }
  await loadValidationConfig(); renderValidadores();
}
async function criarPublicoValidacao() {
  const name = document.getElementById('novoPublicoValidacao').value.trim(); const default_sector_id = document.getElementById('novoPublicoSetor').value;
  if (!name || !default_sector_id) { toast('⚠️ Informe o público e o setor responsável.', true); return; }
  const { error } = await sb.from('validation_targets').insert({ name, default_sector_id });
  if (error) { toast('❌ ' + error.message, true); return; }
  document.getElementById('novoPublicoValidacao').value = ''; await loadValidationConfig(); renderValidadores();
}
async function alterarSetoresValidador(profileId) {
  const ids = Array.from(document.querySelectorAll(`[data-validator="${profileId}"]:checked`)).map((x) => x.value);
  const { error: delError } = await sb.from('validator_sector_assignments').delete().eq('profile_id', profileId);
  if (delError) { toast('❌ ' + delError.message, true); return; }
  if (ids.length) { const { error } = await sb.from('validator_sector_assignments').insert(ids.map((sector_id) => ({ profile_id:profileId, sector_id }))); if (error) { toast('❌ ' + error.message, true); return; } }
  await loadValidationConfig(); renderValidadores(); toast('✅ Prerrogativas do validador atualizadas.');
}
function playNotificationSound() {
  try { const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(.06, c.currentTime); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + .22); o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + .22); } catch (_) { /* navegadores podem bloquear áudio até a primeira interação */ }
}
function renderNotificationBell() {
  const btn = document.getElementById('notificationBell');
  const panel = document.getElementById('notificationPanel');
  const badge = document.getElementById('notificationCount');
  const list = document.getElementById('notificationList');
  if (!btn || !badge || !list) return;
  const unread = notifications.filter(n => !n.read_at).length;
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);
  const driverBottomBadge = document.getElementById('driverBottomNotificationCount');
  if (driverBottomBadge) {
    driverBottomBadge.textContent = unread > 99 ? '99+' : String(unread);
    driverBottomBadge.classList.toggle('hidden', unread === 0);
  }
  list.innerHTML = notifications.length ? notifications.map(n => `
    <button onclick="markNotificationRead('${n.id}')" class="w-full text-left px-3 py-3 border-b hover:bg-slate-50 ${n.read_at ? 'opacity-60' : 'bg-emerald-50/40'}">
      <div class="text-sm font-medium text-slate-800">${escapeHtml(n.title || 'Notificação')}</div>
      <div class="text-xs text-slate-600 mt-1">${escapeHtml(n.message || '')}</div>
      <div class="text-[11px] text-slate-400 mt-1">${n.created_at ? new Date(n.created_at).toLocaleString('pt-BR') : ''}</div>
    </button>`).join('') : '<div class="p-5 text-sm text-slate-500 text-center">Nenhuma notificação.</div>';
}
function toggleNotificationPanel() {
  const panel = document.getElementById('notificationPanel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) renderNotificationBell();
}
async function markNotificationRead(id) {
  if (sb && currentUser) await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('user_id', currentUser.id);
  const n = notifications.find(x => x.id === id);
  if (n) n.read_at = new Date().toISOString();
  renderNotificationBell();
}
async function markAllNotificationsRead() {
  if (sb && currentUser) await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', currentUser.id).is('read_at', null);
  notifications.forEach(n => { if (!n.read_at) n.read_at = new Date().toISOString(); });
  renderNotificationBell();
}
async function createNotification(userId, title, message, excursionId = null) {
  if (!sb || !userId) return false;
  const { error } = await sb.from('notifications').insert([{ user_id: userId, title, message, excursion_id: excursionId }]);
  return !error;
}
async function notifyAdmins(title, message, excursionId = null) {
  if (!sb) return;
  const { data } = await sb.from('profiles').select('id').eq('role', 'admin').eq('active', true);
  for (const p of (data || [])) await createNotification(p.id, title, message, excursionId);
}
function requesterUserId(trip) {
  if (trip?.school_id) {
    const p = allProfiles.find(x => x.role === 'escola' && x.school_id === trip.school_id && x.active !== false);
    if (p) return p.id;
  }
  return null;
}
async function notifyRequester(trip, title, message) {
  const uid = requesterUserId(trip);
  if (uid) await createNotification(uid, title, message, trip.id);
}
async function notifyRequesterEmail(trip, subject, text) {
  const to = (trip?.requester_email || '').trim();
  if (!to) return false;
  return tentarEnviarEmailAutomatico(to, subject, text);
}
function buildRequesterPassengerEmail(trip, link = '') {
  const data = trip.trip_date ? new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR') : '-';
  const origem = `${originName(trip) || '-'}${originAddress(trip) ? ' - ' + originAddress(trip) : ''}${originCity(trip) ? ' - ' + originCity(trip) : ''}`;
  const destino = `${trip.destination || '-'}${trip.destination_address ? ' - ' + trip.destination_address : ''}${trip.city ? ' - ' + trip.city : ''}`;
  return `Olá,

A viagem abaixo está aprovada e já possui motorista/veículo atribuído.

Origem: ${origem}
Destino: ${destino}
Data: ${data}
Saída: ${hhmm(trip.departure_time)} - Retorno: ${hhmm(trip.return_time)}

Agora é necessário preencher a listagem de passageiros com nome completo, tipo e número do documento quando exigido.

${link ? 'Acesse o cadastro de passageiros pelo link abaixo:\n' + link + '\n' : 'Entre no sistema Bora Lá e acesse o menu Validações para preencher a listagem.'}

Após o envio, a listagem será conferida pelo Admin.

${appSettings.remetente_nome || 'Bora Lá - Excursões'}`;
}
function buildRequesterRejectedEmail(trip) {
  const motivo = trip.listagem_parecer_comentario || 'Verifique a listagem e corrija os dados solicitados.';
  return `Olá,

A listagem de passageiros da viagem de ${trip.trip_date ? new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR') : '-'} para ${trip.destination || '-'} foi devolvida para correção.

Motivo:
${motivo}

Corrija a listagem e envie novamente pelo menu Validações.

${appSettings.remetente_nome || 'Bora Lá - Excursões'}`;
}

function showScreen(name, el) {
  closeSidebar(); // no celular, navegar pra uma tela nova fecha a gaveta (sem efeito no desktop)
  if (currentUser && !canViewScreen(name)) {
    name = defaultScreenForCurrentUser();
  }

  document.querySelectorAll('[id^="screen-"]').forEach((sec) => {
    sec.classList.add('hidden-screen');
    sec.classList.remove('active-screen');
  });
  const target = document.getElementById('screen-' + name);
  if (target) {
    target.classList.remove('hidden-screen');
    target.classList.add('active-screen');
  }

  document.querySelectorAll('.sidebar-link, .top-nav-link').forEach((l) => l.classList.remove('active'));
  const link = el || document.querySelector('.sidebar-link[data-screen="' + name + '"]');
  if (link) link.classList.add('active');
  document.querySelectorAll('.top-nav-link[data-screen="' + name + '"]').forEach((l) => l.classList.add('active'));
  document.querySelectorAll('.driver-bottom-link[data-driver-screen]').forEach((l) => {
    l.classList.toggle('active', l.dataset.driverScreen === name);
  });

  const isMotoristaAgenda = name === 'agenda' && currentUser && currentUser.role === 'motorista';
  const titles = {
    dashboard: ['Dashboard', 'Visão geral do sistema'],
    pendencias: ['Pendências', 'Solicitações que aguardam acompanhamento'],
    agenda: isMotoristaAgenda
      ? ['Hoje', `Suas viagens de hoje, por horário de saída`]
      : ['Agenda Mestra', 'Todas as viagens ordenadas por data/hora'],
    agendadata: ['Próximas viagens', 'Sua semana inteira ou os próximos dias, agrupados por dia'],
    agendageral: ['Agenda Geral', 'Viagens confirmadas e escaladas, de todos os motoristas'],
    solicitacao: ['Nova Solicitação', 'Wizard de cadastro de excursão'],
    validacoes: ['Validações', 'Projeto pedagógico e parecer da Pedagogia'],
    km: ['KM Rodado', 'Registre o odômetro do início e do fim do dia'],
    unidades: ['Unidades', 'Escolas e entidades cadastradas'],
    veiculos: ['Veículos', 'Frota disponível'],
    motoristas: ['Motoristas', 'Cadastro de motoristas e cooperativas'],
    cooperativas: ['Cooperativas', 'E-mail de cada cooperativa e assinatura do setor'],
    usuarios: ['Usuários', 'Perfil, unidade e motorista vinculado de cada login'],
    perfisacesso: ['Perfis de acesso', 'Telas e permissões dos perfis administrativos'],
    validadores: ['Validadores', 'Público-alvo, setor responsável e prerrogativas pedagógicas'],
    relatorios: ['Escala', 'Viagens confirmadas e com motorista atribuído'],
  };
  const titulo = name === 'km' && (currentUser?.role === 'admin' || (currentUser?.role === 'operacional' && canViewScreen('km')))
    ? ['KM dos Motoristas', 'Registros, filtros e relatórios por motorista e cooperativa']
    : titles[name];
  document.getElementById('pageTitle').textContent = titulo?.[0] || '';
  document.getElementById('pageSubtitle').textContent = titulo?.[1] || '';

  // Ao trocar de tela, sempre atualiza os dados vindos do Supabase antes de redesenhar.
  // O desenho imediato evita tela vazia; o redesenho após o carregamento garante dados atuais.
  refreshDadosDaTela(name);

  if (name === 'dashboard') renderDashboard();
  if (name === 'pendencias') renderPendencias();
  if (name === 'agenda') renderAgenda();
  if (name === 'agendadata') renderAgendaPorData();
  if (name === 'agendageral') renderAgendaGeralMotorista();
  if (name === 'solicitacao') openSolicitacaoScreen();
  if (name === 'validacoes') openValidacoesScreen();
  if (name === 'km') openKmScreen();
  if (name === 'unidades') renderUnidades();
  if (name === 'veiculos') renderVeiculos();
  if (name === 'motoristas') renderMotoristas();
  if (name === 'cooperativas') { renderCooperativas(); fillSettingsForm(); }
  if (name === 'usuarios') openUsuariosScreen();
  if (name === 'perfisacesso') { loadAccessProfiles().then(renderAccessProfiles); }
  if (name === 'validadores') openValidadoresScreen();
  if (name === 'relatorios') populateRelatorioFilters();
  safeIcons();
}

async function refreshDadosDaTela(name) {
  if (!sb || !currentUser) return;
  try {
    await Promise.all([
      loadSchools(), loadAgenda(), loadProfiles(), loadVehicles(), loadDrivers(), loadKmLogs(), loadCooperativas(), loadNotifications()
    ]);
    if (name === 'usuarios') await loadAllProfiles();
    if (name === 'validacoes') {
      if (currentUser.role === 'escola') { populateValidacaoDestinoEscolaFilter(); renderValidacoesEscola(); }
      else { populateValidacaoOrigemFilter(); renderValidacoesPedagogia(); }
    }
    if (name === 'agenda') { populateAgendaUnidadeFilter(); renderAgenda(); }
    if (name === 'dashboard') renderDashboard();
    if (name === 'pendencias') renderPendencias();
    if (name === 'agendadata') renderAgendaPorData();
    if (name === 'agendageral') renderAgendaGeralMotorista();
    if (name === 'solicitacao') openSolicitacaoScreen();
    if (name === 'km') openKmScreen();
    if (name === 'unidades') renderUnidades();
    if (name === 'veiculos') renderVeiculos();
    if (name === 'motoristas') renderMotoristas();
    if (name === 'cooperativas') { renderCooperativas(); fillSettingsForm(); }
    if (name === 'usuarios') openUsuariosScreen();
    if (name === 'validadores') openValidadoresScreen();
    if (name === 'relatorios') populateRelatorioFilters();
  } catch (err) { console.warn('Atualização ao trocar de tela falhou:', err); }
}

// ============ CARGA DE DADOS ============
async function loadSchools() {
  if (sb) {
    const { data } = await sb.from('schools').select('*').order('name');
    schools = data || [];
  }
}

async function loadVehicles() {
  if (sb) {
    const { data } = await sb.from('vehicles').select('*').order('plate');
    vehicles = data || [];
  }
}

async function loadDrivers() {
  if (sb) {
    const { data } = await sb.from('drivers').select('*').order('name');
    drivers = data || [];
  }
}

async function loadCooperativas() {
  if (sb) {
    const { data } = await sb.from('cooperativas').select('*').order('name');
    cooperativas = data || [];
  }
}

async function loadAppSettings() {
  if (sb) {
    const { data } = await sb.from('app_settings').select('*');
    const map = {};
    (data || []).forEach((r) => { map[r.key] = r.value; });
    appSettings = { remetente_nome: map.remetente_nome || '', remetente_email: map.remetente_email || '', drive_upload_url: map.drive_upload_url || '' };
  }
}

function getDriveUploadUrl() { return (appSettings.drive_upload_url || '').trim(); }

async function loadAgenda() {
  if (sb) {
    const { data } = await sb.from('excursions').select('*').order('trip_date', { ascending: true });
    agenda = data || [];
    await loadExcursionDriversInto(agenda);
  }
}

// Junta a tabela excursion_drivers (motorista(s) de cada viagem) dentro do array de
// viagens, como agenda[i].driver_ids = ['uuid-motorista-1', 'uuid-motorista-2', ...].
async function loadExcursionDriversInto(list) {
  if (!sb || list.length === 0) return;
  const { data } = await sb.from('excursion_drivers').select('excursion_id, driver_id');
  const map = {};
  (data || []).forEach((row) => {
    (map[row.excursion_id] = map[row.excursion_id] || []).push(row.driver_id);
  });
  list.forEach((a) => { a.driver_ids = map[a.id] || []; });
}

async function loadKmLogs() {
  if (sb) {
    let query = sb.from('driver_km_logs').select('*').order('log_date', { ascending: false });
    const { data, error } = await query;
    if (error) { console.warn('Erro ao carregar registros de KM:', error.message); kmLogs = []; return; }
    kmLogs = data || [];
  }
  // modo demo: kmLogs já vem carregado por loadDemoData()/backfillDemoData()
}

// ---- MOTORISTA: registrar/ver o próprio KM + dashboard ----
function myDriverKmLogs() {
  if (!currentUser || !currentUser.driverId) return [];
  return kmLogs.filter((k) => k.driver_id === currentUser.driverId);
}

function todayKmLog(driverId) {
  const hoje = fmtDate(new Date());
  return kmLogs.find((k) => k.driver_id === driverId && k.log_date === hoje);
}

function openKmScreen() {
  const admin = currentUser?.role === 'admin' || (currentUser?.role === 'operacional' && canViewScreen('km'));
  document.getElementById('kmDriverContent')?.classList.toggle('hidden', admin);
  document.getElementById('kmAdminContent')?.classList.toggle('hidden', !admin);
  if (admin) { openKmAdminScreen(); return; }
  renderKmResumo();
  renderKmChart();
  renderKmTable();
}

function renderKmResumo() {
  const box = document.getElementById('kmHojeResumo');
  if (box) {
    const log = todayKmLog(currentUser.driverId);
    if (!log || (log.odometer_start == null && log.odometer_end == null)) {
      box.innerHTML = '<p class="text-slate-400 mb-1">Nenhum registro ainda hoje.</p><button onclick="openKmModal()" class="text-xs text-emerald-600 hover:text-emerald-800">Registrar início do dia</button>';
    } else if (log.odometer_start != null && log.odometer_end == null) {
      box.innerHTML = `<p>Início: <strong>${log.odometer_start} km</strong></p><button onclick="openKmModal('${log.id}')" class="mt-1 text-xs text-emerald-600 hover:text-emerald-800">Registrar fim do dia</button>`;
    } else {
      box.innerHTML = `<p>Início: <strong>${log.odometer_start ?? '—'}</strong> • Fim: <strong>${log.odometer_end ?? '—'}</strong></p><p class="text-emerald-700 font-semibold mt-1">${log.km_rodado ?? '—'} km rodados</p><button onclick="openKmModal('${log.id}')" class="mt-1 text-xs text-slate-500 hover:text-slate-700">Editar</button>`;
    }
  }

  const mine = myDriverKmLogs();
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const weekStart = new Date(hoje); weekStart.setDate(hoje.getDate() - hoje.getDay());
  const weekStartStr = fmtDate(weekStart);
  const monthStartStr = fmtDate(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const semanaKm = mine.filter((k) => k.log_date >= weekStartStr).reduce((s, k) => s + (k.km_rodado || 0), 0);
  const mesKm = mine.filter((k) => k.log_date >= monthStartStr).reduce((s, k) => s + (k.km_rodado || 0), 0);
  const elS = document.getElementById('kmStatSemana'); if (elS) elS.textContent = semanaKm.toFixed(0);
  const elM = document.getElementById('kmStatMes'); if (elM) elM.textContent = mesKm.toFixed(0);
}

function renderKmTable() {
  const tbody = document.getElementById('kmTable');
  if (!tbody) return;
  const mine = myDriverKmLogs().slice().sort((a, b) => (b.log_date || '').localeCompare(a.log_date || '')).slice(0, 30);
  if (!mine.length) { tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-slate-500 text-sm">Nenhum registro ainda</td></tr>'; return; }
  tbody.innerHTML = mine.map((k) => `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-sm">${new Date(k.log_date + 'T00:00').toLocaleDateString('pt-BR')}</td>
      <td class="px-4 py-3 text-sm">${k.odometer_start ?? '—'}</td>
      <td class="px-4 py-3 text-sm">${k.odometer_end ?? '—'}</td>
      <td class="px-4 py-3 text-sm font-medium">${k.km_rodado != null ? k.km_rodado + ' km' : '—'}</td>
      <td class="px-4 py-3 text-sm"><button onclick="openKmModal('${k.id}')" class="text-xs text-emerald-600 hover:text-emerald-800">Editar</button></td>
    </tr>`).join('');
}

let chartKmInstance = null;
function renderKmChart() {
  if (!window.Chart) return;
  const periodoSel = document.getElementById('kmChartPeriodo');
  const periodo = periodoSel ? periodoSel.value : 'semana';
  const mine = myDriverKmLogs();
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  let labels = [], data = [];

  if (periodo === 'ano') {
    const map = {};
    mine.forEach((k) => { const mk = monthKey(k.log_date); map[mk] = (map[mk] || 0) + (k.km_rodado || 0); });
    const meses = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1); meses.push(fmtDate(d).slice(0, 7)); }
    labels = meses.map(monthLabel);
    data = meses.map((mk) => map[mk] || 0);
  } else {
    const dias = periodo === 'mes' ? 30 : 7;
    const map = {};
    mine.forEach((k) => { map[k.log_date] = (map[k.log_date] || 0) + (k.km_rodado || 0); });
    const datas = [];
    for (let i = dias - 1; i >= 0; i--) { const d = new Date(hoje); d.setDate(hoje.getDate() - i); datas.push(fmtDate(d)); }
    labels = datas.map((d) => new Date(d + 'T00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
    data = datas.map((d) => map[d] || 0);
  }

  const ctx = document.getElementById('chartKm');
  if (!ctx) return;
  if (chartKmInstance) chartKmInstance.destroy();
  chartKmInstance = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Km rodado', data, backgroundColor: '#059669' }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}

// ---- modal de registro/edição (usado pelo motorista pra ele mesmo, e pelo admin pra qualquer motorista) ----
let kmEditTargetId = null;
let kmModalIsAdmin = false;

function openKmModal(id) {
  if (currentUser?.role === 'operacional' && !canEditScreen('km')) { toast('⚠️ Seu perfil permite apenas consultar os registros de KM.', true); return; }
  kmEditTargetId = id || null;
  kmModalIsAdmin = currentUser.role === 'admin' || (currentUser?.role === 'operacional' && canEditScreen('km'));
  const log = id ? kmLogs.find((k) => k.id === id) : null;

  document.getElementById('kmModalTitle').textContent = log ? '📟 Editar registro de KM' : '📟 Registrar odômetro';
  const motoristaWrap = document.getElementById('kmModalMotoristaWrap');
  motoristaWrap.classList.toggle('hidden', !kmModalIsAdmin);
  if (kmModalIsAdmin) {
    const sel = document.getElementById('kmMotoristaId');
    sel.innerHTML = drivers.map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
    sel.value = log ? log.driver_id : (drivers[0] ? drivers[0].id : '');
    document.getElementById('kmModalInfo').textContent = '';
  } else {
    const d = drivers.find((x) => x.id === currentUser.driverId);
    document.getElementById('kmModalInfo').textContent = d ? 'Motorista: ' + d.name : '';
  }
  document.getElementById('kmData').value = log ? log.log_date : fmtDate(new Date());
  document.getElementById('kmOdometroInicio').value = log && log.odometer_start != null ? log.odometer_start : '';
  document.getElementById('kmOdometroFim').value = log && log.odometer_end != null ? log.odometer_end : '';
  document.getElementById('kmObservacoes').value = log ? (log.observacoes || '') : '';
  updateKmRodadoPreview();
  document.getElementById('kmModal').classList.remove('hidden');
}
function closeKmModal() { document.getElementById('kmModal').classList.add('hidden'); kmEditTargetId = null; }

function updateKmRodadoPreview() {
  const el = document.getElementById('kmRodadoPreview');
  if (!el) return;
  const ini = parseFloat(document.getElementById('kmOdometroInicio').value);
  const fim = parseFloat(document.getElementById('kmOdometroFim').value);
  if (!isNaN(ini) && !isNaN(fim)) {
    el.innerHTML = fim < ini
      ? '<span class="text-red-600">⚠️ Odômetro final não pode ser menor que o inicial.</span>'
      : `<span class="text-emerald-700 font-medium">${(fim - ini).toFixed(1)} km rodados</span>`;
  } else {
    el.textContent = '';
  }
}

async function confirmSaveKm() {
  const driverId = kmModalIsAdmin ? document.getElementById('kmMotoristaId').value : currentUser.driverId;
  if (!driverId) { toast('⚠️ Motorista não identificado (peça pro admin vincular seu usuário a um motorista, na tela Usuários).', true); return; }
  const logDate = document.getElementById('kmData').value;
  if (!logDate) { toast('⚠️ Informe a data.', true); return; }
  const iniRaw = document.getElementById('kmOdometroInicio').value;
  const fimRaw = document.getElementById('kmOdometroFim').value;
  const odometer_start = iniRaw === '' ? null : parseFloat(iniRaw);
  const odometer_end = fimRaw === '' ? null : parseFloat(fimRaw);
  if (odometer_start != null && odometer_end != null && odometer_end < odometer_start) {
    toast('⚠️ Odômetro final não pode ser menor que o inicial.', true); return;
  }
  const observacoes = document.getElementById('kmObservacoes').value.trim() || null;
  const now = new Date().toISOString();

  // O banco só aceita 1 registro por motorista/dia (constraint) - se já existir um pra
  // esse motorista+data (e não for o que já estamos editando), atualiza ele em vez de
  // tentar inserir duplicado.
  const existing = kmLogs.find((k) => k.driver_id === driverId && k.log_date === logDate && k.id !== kmEditTargetId);
  const targetId = kmEditTargetId || (existing ? existing.id : null);

  const patch = { driver_id: driverId, log_date: logDate, odometer_start, odometer_end, observacoes };
  if (odometer_start != null) patch.odometer_start_at = now;
  if (odometer_end != null) patch.odometer_end_at = now;

  if (sb) {
    if (targetId) {
      const { error } = await sb.from('driver_km_logs').update(patch).eq('id', targetId);
      if (error) { toast('❌ ' + error.message, true); return; }
    } else {
      const { error } = await sb.from('driver_km_logs').insert([{ ...patch, created_by: currentUser.id }]);
      if (error) { toast('❌ ' + error.message, true); return; }
    }
  } else {
    if (targetId) {
      const row = kmLogs.find((k) => k.id === targetId);
      if (row) {
        Object.assign(row, patch);
        row.km_rodado = (row.odometer_start != null && row.odometer_end != null) ? +(row.odometer_end - row.odometer_start).toFixed(1) : null;
      }
    } else {
      kmLogs.push({
        id: 'km' + Date.now(), ...patch,
        km_rodado: (odometer_start != null && odometer_end != null) ? +(odometer_end - odometer_start).toFixed(1) : null,
      });
    }
    saveDemoData();
  }
  await loadKmLogs();
  closeKmModal();
  toast('✅ Registro de KM salvo!');
  if (currentUser.role === 'admin' || (currentUser?.role === 'operacional' && canViewScreen('km'))) renderKmAdmin();
  else { renderKmResumo(); renderKmChart(); renderKmTable(); }
}

// ---- ADMIN: editar qualquer registro + relatório por motorista/cooperativa/período ----
function openKmAdminScreen() {
  const motoristaSel = document.getElementById('kmAdminFiltroMotorista');
  if (motoristaSel) motoristaSel.innerHTML = '<option value="">Todos</option>' + drivers.map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
  const coopSel = document.getElementById('kmAdminFiltroCooperativa');
  if (coopSel) coopSel.innerHTML = '<option value="">Todas</option>' + cooperativas.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  renderKmAdmin();
}

function filterKmAdmin() {
  const motoristaId = document.getElementById('kmAdminFiltroMotorista').value;
  const coopId = document.getElementById('kmAdminFiltroCooperativa').value;
  const inicio = document.getElementById('kmAdminFiltroInicio').value;
  const fim = document.getElementById('kmAdminFiltroFim').value;
  return kmLogs.filter((k) => {
    if (motoristaId && k.driver_id !== motoristaId) return false;
    if (coopId) {
      const d = drivers.find((x) => x.id === k.driver_id);
      if (!d || d.cooperativa_id !== coopId) return false;
    }
    if (inicio && k.log_date < inicio) return false;
    if (fim && k.log_date > fim) return false;
    return true;
  });
}

function renderKmAdmin() {
  const rows = filterKmAdmin().slice().sort((a, b) => (b.log_date || '').localeCompare(a.log_date || ''));
  const tbody = document.getElementById('kmAdminTable');
  if (tbody) {
    tbody.innerHTML = rows.length ? rows.map((k) => {
      const d = drivers.find((x) => x.id === k.driver_id);
      return `
      <tr class="hover:bg-slate-50">
        <td class="px-4 py-3 text-sm">${new Date(k.log_date + 'T00:00').toLocaleDateString('pt-BR')}</td>
        <td class="px-4 py-3 text-sm">${d ? d.name : '—'}</td>
        <td class="px-4 py-3 text-sm">${d ? cooperativaName(d) : '—'}</td>
        <td class="px-4 py-3 text-sm">${k.odometer_start ?? '—'}</td>
        <td class="px-4 py-3 text-sm">${k.odometer_end ?? '—'}</td>
        <td class="px-4 py-3 text-sm font-medium">${k.km_rodado != null ? k.km_rodado + ' km' : '—'}</td>
        <td class="px-4 py-3 text-sm"><button onclick="openKmModal('${k.id}')" class="text-xs text-emerald-600 hover:text-emerald-800">Editar</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="text-center py-8 text-slate-500 text-sm">Nenhum registro encontrado</td></tr>';
  }
  const total = rows.reduce((s, k) => s + (k.km_rodado || 0), 0);
  const resumo = document.getElementById('kmAdminResumo');
  if (resumo) resumo.textContent = `${rows.length} registro(s) • ${total.toFixed(0)} km no total`;
}

function exportKmPDF() {
  if (!window.jspdf) { toast('⚠️ Não foi possível carregar o gerador de PDF (verifique sua internet) e tente novamente.', true); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const rows = filterKmAdmin().slice().sort((a, b) => (a.log_date || '').localeCompare(b.log_date || ''));

  doc.setFillColor(5, 150, 105);
  doc.rect(0, 0, 210, 25, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('BORA LÁ - EXCURSÕES', 14, 16);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Relatório de KM dos motoristas', 196, 16, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('KM Rodado por Motorista', 14, 40);
  doc.autoTable({
    startY: 45,
    head: [['Data', 'Motorista', 'Cooperativa', 'Odômetro início', 'Odômetro fim', 'Km rodado']],
    body: rows.map((k) => {
      const d = drivers.find((x) => x.id === k.driver_id);
      return [
        new Date(k.log_date + 'T00:00').toLocaleDateString('pt-BR'),
        d ? d.name : '-', d ? cooperativaName(d) : '-',
        k.odometer_start ?? '-', k.odometer_end ?? '-', k.km_rodado != null ? k.km_rodado : '-',
      ];
    }),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [5, 150, 105] },
  });

  const total = rows.reduce((s, k) => s + (k.km_rodado || 0), 0);
  const finalY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 8 : 60;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Total: ${total.toFixed(0)} km`, 14, finalY);

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')} - Página ${i} de ${pages}`, 14, 290);
  }
  doc.save(`bora-la-km-${Date.now()}.pdf`);
  toast('📄 PDF gerado com sucesso!');
}

function exportKmExcel() {
  if (!window.XLSX) { toast('⚠️ Não foi possível carregar o gerador de Excel (verifique sua internet) e tente novamente.', true); return; }
  const rows = filterKmAdmin().slice().sort((a, b) => (a.log_date || '').localeCompare(b.log_date || ''));
  const data = rows.map((k) => {
    const d = drivers.find((x) => x.id === k.driver_id);
    return {
      Data: new Date(k.log_date + 'T00:00').toLocaleDateString('pt-BR'),
      Motorista: d ? d.name : '-',
      Cooperativa: d ? cooperativaName(d) : '-',
      'Odômetro início': k.odometer_start ?? '',
      'Odômetro fim': k.odometer_end ?? '',
      'Km rodado': k.km_rodado ?? '',
    };
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'KM');
  XLSX.writeFile(wb, `bora-la-km-${Date.now()}.xlsx`);
  toast('📊 Excel gerado com sucesso!');
}

function schoolName(id) { return schools.find((s) => s.id === id)?.name || '—'; }
function schoolAddress(id) { return schools.find((s) => s.id === id)?.address || null; }

// Origem real do transporte. Nunca usa o nome do solicitante como Origem:
// - excursão normal: unidade municipal cadastrada (school_id)
// - agendamento recebido: origin_name/origin_address
// - solicitação externa: origin_name/origin_address
function originName(trip) {
  if (trip?.solicitation_type === 'agendamento') return trip.origin_name || 'Entidade / Outro';
  if (trip?.school_id) return schoolName(trip.school_id);
  return trip?.origin_name || 'Entidade / Outro';
}

function originAddress(trip) {
  if (trip?.origin_address) return trip.origin_address;
  if (trip?.school_id) return schoolAddress(trip.school_id) || '';
  return '';
}

function originCity(trip) {
  if (trip?.origin_city) return trip.origin_city;
  if (trip?.school_id) return schools.find((x) => x.id === trip.school_id)?.city || '';
  return '';
}



// Nome/endereço de quem solicitou a viagem - unidade cadastrada (schools) ou "Outra
// unidade" (não cadastrada, dados digitados na hora pelo admin no Passo 1 da wizard).
function requesterName(trip) {
  return trip.school_id ? schoolName(trip.school_id) : (trip.requester_name || '—');
}
function requesterAddress(trip) {
  return (trip.school_id ? schoolAddress(trip.school_id) : trip.requester_address) || '';
}
// O telefone permanece gravado na viagem; para viagens antigas, procuramos o
// perfil de quem solicitou e, por último, o telefone da unidade.
function requesterContact(trip) {
  if (trip?.requester_contact) return trip.requester_contact;
  const perfil = trip?.created_by ? (profilesById[trip.created_by] || allProfiles.find((p) => p.id === trip.created_by)) : null;
  if (perfil?.phone) return perfil.phone;
  return trip?.school_id ? (schools.find((s) => s.id === trip.school_id)?.phone || '') : '';
}
function currentRequesterContact(schoolId) {
  const perfil = currentUser ? (profilesById[currentUser.id] || allProfiles.find((p) => p.id === currentUser.id)) : null;
  return perfil?.phone || (schoolId ? (schools.find((s) => s.id === schoolId)?.phone || null) : null);
}
function vehiclePlate(id) { return vehicles.find((v) => v.id === id)?.plate || null; }
function driverName(id) { return drivers.find((d) => d.id === id)?.name || null; }

// Cada motorista dirige sempre o próprio veículo (vehicle_id) - a capacidade exibida
// numa viagem vem sempre do veículo do motorista atribuído, nunca de uma escolha solta.
function driverVehicle(driverId) {
  const d = drivers.find((x) => x.id === driverId);
  if (!d || !d.vehicle_id) return null;
  return vehicles.find((v) => v.id === d.vehicle_id) || null;
}

function cooperativaById(id) {
  return id ? (cooperativas.find((c) => c.id === id) || null) : null;
}
// Nome da cooperativa de um motorista - usa o vínculo novo (cooperativa_id) e cai pro
// texto livre antigo (m.cooperative) se o motorista ainda não tiver sido religado.
function cooperativaName(m) {
  const c = cooperativaById(m.cooperativa_id);
  return (c && c.name) || m.cooperative || '-';
}
// Preenche um <select> com as cooperativas cadastradas, marcando a opção selecionada.
function populateCooperativaSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const visiveis = cooperativas.filter((c) => c.active !== false || c.id === selectedId);
  sel.innerHTML = '<option value="">— nenhuma —</option>'
    + visiveis.map((c) => `<option value="${c.id}" ${selectedId === c.id ? 'selected' : ''}>${c.name}${c.active === false ? ' (bloqueada)' : ''}${c.email ? '' : ' (sem e-mail)'}</option>`).join('');
}

function driverLabel(driverId) {
  const d = drivers.find((x) => x.id === driverId);
  if (!d) return '—';
  const v = driverVehicle(driverId);
  return d.name + (v ? ` - ${v.capacity}` : '');
}

function driversLabelHtml(ids) {
  if (!ids || ids.length === 0) return '<span class="text-slate-400">—</span>';
  return ids.map((id) => `<div>${driverLabel(id)}</div>`).join('');
}

function totalCapacity(ids) {
  return (ids || []).reduce((sum, id) => { const v = driverVehicle(id); return sum + (v ? v.capacity : 0); }, 0);
}

function totalPassengers(trip) {
  // Cadeirante e apoio usam veículo adaptado da cooperativa; são informados,
  // mas não consomem capacidade do veículo da Secretaria.
  return (trip.students_count || 0) + (trip.companions_count || 0);
}

// Em trajetos inteiramente dentro de Nova Lima, um único veículo pode fazer mais de
// uma volta. Não criamos novas agendas: este número é apenas a orientação operacional
// exibida ao motorista. PCD e apoio já ficam fora de totalPassengers().
function viagemInteiraEmNovaLima(trip) {
  return !!trip && !viagemForaDeNovaLima(trip) && !origemExternaForaDeNovaLima(trip);
}

function numeroViagensIndicadas(trip, ids = trip?.driver_ids || []) {
  if (!viagemInteiraEmNovaLima(trip) || ids.length !== 1) return 1;
  const capacidade = totalCapacity(ids);
  return capacidade > 0 ? Math.max(1, Math.ceil(totalPassengers(trip) / capacidade)) : 1;
}
async function notifyAssignedDrivers(trip, title, message) {
  for (const p of allProfiles.filter((x) => x.role === 'motorista' && (trip.driver_ids || []).includes(x.driver_id) && x.active !== false)) await createNotification(p.id, title, message, trip.id);
}

async function requestOwnPasswordReset() {
  if (!sb) { toast('⚠️ A recuperação de senha exige a conexão com o Supabase.', true); return; }
  const email = window.prompt('Informe seu e-mail para receber o link de recuperação:');
  if (!email) return;
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: 'https://neil-semed.github.io/Bora_la/redefinir-senha.html' });
  // A mensagem é propositalmente genérica, para não revelar se o e-mail existe.
  toast(error ? '✅ Se o e-mail estiver cadastrado, você receberá instruções de recuperação.' : '✅ Se o e-mail estiver cadastrado, você receberá instruções de recuperação.');
}

function openChangePasswordModal() {
  if (!sb || !currentUser?.email) { toast('⚠️ A troca de senha exige uma sessão conectada.', true); return; }
  ['currentPassword', 'newOwnPassword', 'confirmOwnPassword'].forEach((id) => { const field = document.getElementById(id); if (field) field.value = ''; });
  document.getElementById('changePasswordModal').classList.remove('hidden');
  document.getElementById('currentPassword')?.focus();
}

function closeChangePasswordModal() { document.getElementById('changePasswordModal')?.classList.add('hidden'); }

async function saveOwnPassword() {
  if (!sb || !currentUser?.email) return;
  const current = document.getElementById('currentPassword').value;
  const next = document.getElementById('newOwnPassword').value;
  const confirmation = document.getElementById('confirmOwnPassword').value;
  if (!current || !next || !confirmation) { toast('⚠️ Preencha todos os campos.', true); return; }
  if (next.length < 8) { toast('⚠️ A nova senha deve ter ao menos 8 caracteres.', true); return; }
  if (next !== confirmation) { toast('⚠️ A confirmação não confere.', true); return; }
  try {
    // Reautenticação antes da alteração: uma sessão esquecida em computador público não
    // pode ser usada para trocar a credencial sem conhecer a senha atual.
    const { error: authError } = await sb.auth.signInWithPassword({ email: currentUser.email, password: current });
    if (authError) { toast('❌ A senha atual não confere.', true); return; }
    const { error } = await sb.auth.updateUser({ password: next });
    if (error) throw error;
    closeChangePasswordModal();
    toast('✅ Senha alterada com segurança.');
  } catch (err) { toast('❌ Não foi possível trocar a senha: ' + (err?.message || err), true); }
}

async function sendPasswordResetForUser(id) {
  if (currentUser?.role !== 'admin' || !sb) { toast('⚠️ Disponível apenas para Admin com Supabase configurado.', true); return; }
  const profile = allProfiles.find((p) => p.id === id); if (!profile?.email) return;
  if (!window.confirm(`Enviar e-mail de recuperação de senha para ${profile.email}?`)) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const url = localStorage.getItem('sb_url') || DEFAULT_SUPABASE_URL;
    const key = localStorage.getItem('sb_key') || DEFAULT_SUPABASE_ANON_KEY;
    const resp = await fetch(`${url}/functions/v1/admin-send-password-reset`, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${session?.access_token || key}`, apikey:key }, body:JSON.stringify({ email:profile.email }) });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || body.error) { toast('❌ ' + (body.error || 'Não foi possível enviar o e-mail.'), true); return; }
    toast('✅ E-mail de recuperação enviado. A senha não foi exposta ao Admin.');
  } catch (err) { toast('❌ Falha ao solicitar recuperação: ' + (err?.message || err), true); }
}
function viagemConfirmadaParaMotorista(trip) {
  return ['approved', 'in_transit', 'completed'].includes(trip.status)
    && !['cancelada', 'reprovada'].includes(trip.situacao);
}

// Deriva "precisa de contato com cooperativa" direto da viagem (destino fora de Nova
// Lima, ATF já emitida, ou tem aluno PCD) - extraída daqui pra ser reaproveitada tanto
// pela Agenda (botões) quanto pela listagem de passageiros por veículo (novo fluxo).
function precisaCooperativa(a) {
  const cidadeForaDeNL = cidadeEhForaDeNovaLima(a.city);
  const origemForaDeNL = cidadeEhForaDeNovaLima(originCity(a));
  return !!(cidadeForaDeNL || origemForaDeNL || a.atf_status === 'emitida' || (a.pca_count || 0) > 0);
}
// "Validada completamente" = já passou pela pedagogia E o admin já atribuiu motorista(s)
// (status vira "approved"/"in_transit"/"completed") - só a partir daí faz sentido cobrar
// listagem de passageiros (nem todo pedido chega a ser aceito).
function viagemValidadaCompletamente(a) {
  return ['approved', 'in_transit', 'completed'].includes(a.status);
}

// ============ DASHBOARD ============
let chartMesInstance = null;
let chartUnidadeInstance = null;

function monthKey(dateStr) { return (dateStr || '').slice(0, 7); }
function monthLabel(key) {
  const [y, m] = key.split('-');
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${meses[parseInt(m, 10) - 1] || m}/${(y || '').slice(2)}`;
}
const MESES_COMPLETOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
// Nome completo do mês (pro dropdown do filtro do Dashboard) - monthLabel() acima
// continua sendo usado nos eixos dos gráficos, onde a abreviação cabe melhor.
function monthLabelFull(key) {
  const [y, m] = (key || '').split('-');
  return `${MESES_COMPLETOS[parseInt(m, 10) - 1] || m} de ${y || ''}`;
}

// Dropdown com o nome dos meses que de fato têm viagem (em vez do seletor nativo de
// mês/ano do navegador, que só mostra números) - só lista os meses que existem nos
// dados visíveis pro perfil logado, então nunca fica cheio de opções sem resultado.
function populateDashMesFilter(visible) {
  const sel = document.getElementById('dashFiltroMes');
  if (!sel) return;
  const atual = sel.value;
  const keys = [...new Set((visible || []).map((a) => monthKey(a.trip_date)).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Todos os meses</option>' + keys.map((k) => `<option value="${k}">${monthLabelFull(k)}</option>`).join('');
  sel.value = keys.includes(atual) ? atual : '';
}

function populateDashUnidadeFilter() {
  const sel = document.getElementById('dashFiltroUnidade');
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todas</option>'
    + schools.filter((s) => s.tipo !== 'entidade').map((s) => `<option value="${s.id}">${s.name}</option>`).join('')
    + '<option value="__OUTROS__">Entidade / Outro</option>';
  sel.value = atual;
}

function renderDashboardCharts(visible) {
  if (!window.Chart) return; // biblioteca de gráficos não carregou (ex: sem internet) - segue sem quebrar o resto do dashboard
  const mesEl = document.getElementById('dashFiltroMes');
  const unidadeEl = document.getElementById('dashFiltroUnidade');
  const unidadeWrap = document.getElementById('dashFiltroUnidadeWrap');
  const mesFiltro = mesEl ? mesEl.value : '';
  const dataFiltro = document.getElementById('dashFiltroData')?.value || '';
  // Escondido pro perfil Escola (ela já só vê as próprias solicitações - filtrar por
  // unidade não faz sentido pra quem só tem uma) - ignora o valor enquanto escondido,
  // mesmo modo escondido do filtro de Unidade na Agenda.
  const unidadeFiltro = (unidadeEl && !(unidadeWrap && unidadeWrap.classList.contains('hidden'))) ? unidadeEl.value : '';

  const dados = visible.filter((a) => {
    if (mesFiltro && monthKey(a.trip_date) !== mesFiltro) return false;
    if (dataFiltro && a.trip_date !== dataFiltro) return false;
    if (unidadeFiltro && a.school_id !== unidadeFiltro) return false;
    return true;
  });

  const porMes = {};
  dados.forEach((a) => { const k = monthKey(a.trip_date); porMes[k] = (porMes[k] || 0) + 1; });
  const mesesOrdenados = Object.keys(porMes).sort();

  const porUnidade = {};
  dados.forEach((a) => { const nome = schoolName(a.school_id) !== '—' ? schoolName(a.school_id) : (a.requester_name || 'Outra'); porUnidade[nome] = (porUnidade[nome] || 0) + 1; });
  const unidadesOrdenadas = Object.entries(porUnidade).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const ctx1 = document.getElementById('chartPorMes');
  if (ctx1) {
    if (chartMesInstance) chartMesInstance.destroy();
    chartMesInstance = new Chart(ctx1, {
      type: 'line',
      data: { labels: mesesOrdenados.map(monthLabel), datasets: [{ label: 'Viagens', data: mesesOrdenados.map((k) => porMes[k]), borderColor: '#059669', backgroundColor: 'rgba(5,150,105,.14)', fill: true, tension: .36, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: '#fff', pointBorderWidth: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: 'Evolução de viagens', align: 'start', color: '#1e293b', font: { size: 14, weight: '600' } } }, scales: { y: { beginAtZero: true, ticks: { precision: 0, color: '#64748b' }, grid: { color: 'rgba(148,163,184,.16)' } }, x: { ticks: { color: '#64748b' }, grid: { display: false } } } },
    });
  }
  const ctx2 = document.getElementById('chartPorUnidade');
  if (ctx2) {
    if (chartUnidadeInstance) chartUnidadeInstance.destroy();
    chartUnidadeInstance = new Chart(ctx2, {
      type: 'doughnut',
      data: { labels: unidadesOrdenadas.map((e) => e[0]), datasets: [{ data: unidadesOrdenadas.map((e) => e[1]), backgroundColor: ['#059669','#0ea5e9','#6366f1','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#f97316','#64748b','#ec4899'], borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '64%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, boxHeight: 10, padding: 12, color: '#475569', font: { size: 14, weight: '600' } } }, title: { display: true, text: 'Distribuição por unidade', align: 'start', color: '#1e293b', font: { size: 14, weight: '600' } } } },
    });
  }
}

function renderDashboard() {
  const visibleBruto = getVisibleAgenda();
  const mesFiltro = document.getElementById('dashFiltroMes')?.value || '';
  const dataFiltro = document.getElementById('dashFiltroData')?.value || '';
  const unidadeFiltro = document.getElementById('dashFiltroUnidade')?.value || '';
  const visible = visibleBruto.filter((a) => (!mesFiltro || monthKey(a.trip_date) === mesFiltro) && (!dataFiltro || a.trip_date === dataFiltro) && (!unidadeFiltro || a.school_id === unidadeFiltro));
  const hoje = fmtDate(new Date());
  const viagensHoje = visible.filter((a) => a.trip_date === hoje).length;
  const pendentes = visible.filter((a) => a.situacao === 'sem_validacao').length;
  const aprovadas = visible.filter((a) => a.situacao === 'aprovada' || a.situacao === 'confirmada').length;
  const alunos = visible.reduce((s, a) => s + (a.students_count || 0), 0);
  const canceladas = visible.filter((a) => a.situacao === 'cancelada').length;
  const desaprovadas = visible.filter((a) => a.situacao === 'reprovada');

  document.getElementById('statHoje').textContent = viagensHoje;
  document.getElementById('statPendentes').textContent = pendentes;
  const pendentesLabel = document.getElementById('statPendentesLabel');
  if (pendentesLabel) pendentesLabel.textContent = currentUser?.role === 'pedagogia' ? 'Validações pendentes' : 'Pendentes';
  document.getElementById('statAprovadas').textContent = aprovadas;
  document.getElementById('statAlunos').textContent = alunos;
  document.getElementById('statCanceladas').textContent = canceladas;
  document.getElementById('statDesaprovadas').textContent = desaprovadas.length;

  const porMotivo = {};
  desaprovadas.forEach((a) => { const m = a.rejection_reason || 'Sem motivo'; porMotivo[m] = (porMotivo[m] || 0) + 1; });
  const motivosEl = document.getElementById('statDesaprovadasMotivos');
  if (motivosEl) {
    motivosEl.innerHTML = Object.entries(porMotivo).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<div>${n}x ${m}</div>`).join('');
  }

  populateDashMesFilter(visibleBruto);
  populateDashUnidadeFilter();
  const dashUnidadeWrap = document.getElementById('dashFiltroUnidadeWrap');
  // Perfil Escola só vê as próprias viagens, e Motorista só vê as viagens atribuídas a ele
  // (getVisibleAgenda já filtra isso pros dois) - um filtro de "Unidade" ali não serve pra
  // nada além de confundir, então some pros dois.
  const escondeFiltroUnidadeDash = currentUser.role === 'escola' || currentUser.role === 'motorista';
  if (dashUnidadeWrap) dashUnidadeWrap.classList.toggle('hidden', escondeFiltroUnidadeDash);
  renderDashboardCharts(visible);

  const proximas = visible
    .filter((a) => a.trip_date >= hoje && a.situacao !== 'reprovada' && a.situacao !== 'cancelada')
    .sort((a, b) => (a.trip_date + a.departure_time).localeCompare(b.trip_date + b.departure_time))
    .slice(0, 5);

  const container = document.getElementById('proximasViagens');
  if (proximas.length === 0) {
    container.innerHTML = '<p class="text-sm text-slate-500 text-center py-8">Nenhuma viagem agendada</p>';
    return;
  }

  container.innerHTML = proximas.map((a) => `
    <div class="flex items-center justify-between p-3 border border-slate-100 rounded-lg hover:bg-slate-50">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-lg bg-emerald-100 flex flex-col items-center justify-center shrink-0">
          <span class="text-xs text-emerald-700 font-semibold">${new Date(a.trip_date + 'T00:00').toLocaleDateString('pt-BR', { month: 'short' })}</span>
          <span class="text-lg font-bold text-emerald-800">${new Date(a.trip_date + 'T00:00').getDate()}</span>
        </div>
        <div>
          <div class="font-medium text-slate-800">${a.destination}</div>
          <div class="text-xs text-slate-500">${schoolName(a.school_id)} • ${hhmm(a.departure_time)} • ${a.students_count} passageiros</div>
        </div>
      </div>
      <span style="${SITUACAO_COLORS[a.situacao] || ''}" class="px-2 py-1 rounded text-xs font-medium">${SITUACAO_LABELS[a.situacao] || a.situacao}</span>
    </div>
  `).join('');
}

function statusLabel(s) {
  return { pending: 'Pendente', pedagogy_approved: 'Aprov. Pedagogia', approved: 'Aprovada', in_transit: 'Em trânsito', transit: 'Em trânsito', rejected: 'Recusada', completed: 'Concluída' }[s] || s;
}

// ============ AGENDA ============
// Filtro por origem (admin/pedagogia). Agendamentos e registros sem unidade municipal
// cadastrada ficam agrupados em Entidade / Outro.
function origemFiltroEhOutro(trip) {
  if (!trip) return true;
  if (trip.solicitation_type === 'agendamento') return true;
  const escola = trip.school_id ? schools.find((s) => s.id === trip.school_id) : null;
  return !escola || escola.tipo !== 'escola';
}

function origemFiltroId(trip) {
  return origemFiltroEhOutro(trip) ? '__OUTROS__' : String(trip.school_id);
}

function populateAgendaUnidadeFilter() {
  const sel = document.getElementById('filtroUnidade');
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todas</option>'
    + schools.filter((s) => s.tipo !== 'entidade').map((s) => `<option value="${s.id}">${s.name}</option>`).join('')
    + '<option value="__OUTROS__">Entidade / Outro</option>';
  sel.value = atual;
}

function filterAgenda() {
  const data = document.getElementById('filtroData').value;
  const periodo = document.getElementById('filtroPeriodo').value; // 'dia' | 'semana' | 'mes'
  const situacao = document.getElementById('filtroSituacao').value;
  const unidadeSel = document.getElementById('filtroUnidade');
  const unidade = unidadeSel && !unidadeSel.closest('#filtroUnidadeWrap').classList.contains('hidden') ? unidadeSel.value : '';

  // A aba "Hoje" é pessoal e não usa filtros administrativos. Uma escala atribuída
  // já deve aparecer para o motorista, exceto se tiver sido cancelada/reprovada.
  if (currentUser?.role === 'motorista') {
    const hoje = fmtDate(new Date());
    const minhasViagens = agenda.filter((a) => !['cancelada', 'reprovada'].includes(a.situacao)
      && (a.driver_ids || []).includes(currentUser.driverId));
    const viagensHoje = minhasViagens.filter((a) => a.trip_date === hoje);

    motoristaHojeDataExibida = hoje;
    motoristaHojeUsaProximaData = false;
    if (viagensHoje.length) return viagensHoje;

    // Em um dia sem escala, a próxima data futura atribuída é mais útil do que
    // uma tela vazia. Nunca buscamos uma viagem passada nesta alternativa.
    const proximaData = minhasViagens
      .map((a) => a.trip_date)
      .filter((dataViagem) => dataViagem > hoje)
      .sort()[0];
    if (!proximaData) return [];

    motoristaHojeDataExibida = proximaData;
    motoristaHojeUsaProximaData = true;
    return minhasViagens.filter((a) => a.trip_date === proximaData);
  }
  const base = getVisibleAgenda();
  return base.filter((a) => {
    if (situacao && a.situacao !== situacao) return false;
    if (unidade && origemFiltroId(a) !== unidade) return false;

    if (periodo === 'semana' || periodo === 'mes') {
      const ref = data ? new Date(data + 'T00:00') : new Date();
      const t = new Date(a.trip_date + 'T00:00');
      if (periodo === 'semana') {
        const start = new Date(ref); start.setDate(ref.getDate() - ref.getDay());
        const end = new Date(start); end.setDate(start.getDate() + 6);
        if (t < start || t > end) return false;
      } else {
        if (t.getFullYear() !== ref.getFullYear() || t.getMonth() !== ref.getMonth()) return false;
      }
    } else if (data && a.trip_date !== data) {
      return false;
    }
    return true;
  });
}

async function atualizarAgendaMestra() {
  if (!sb) { renderAgenda(); toast('🔄 Agenda atualizada (modo demonstração).'); return; }
  await Promise.all([loadSchools(), loadVehicles(), loadDrivers(), loadCooperativas(), loadAgenda()]);
  renderAgenda();
  await loadNotifications();
  toast('🔄 Agenda Mestra atualizada diretamente do Supabase.');
}

function filtrarAgenda() { renderAgenda(); }

function renderAgenda() {
  const roleVeUnidade = currentUser && (currentUser.role === 'admin' || currentUser.role === 'pedagogia' || (currentUser.role === 'operacional' && canViewScreen('agenda')));
  const filtroUnidadeWrap = document.getElementById('filtroUnidadeWrap');
  if (filtroUnidadeWrap) filtroUnidadeWrap.classList.toggle('hidden', !roleVeUnidade);
  if (roleVeUnidade) populateAgendaUnidadeFilter();

  // Motorista ("Minhas Viagens") não precisa desse filtro: a Situação já aparece bem
  // visível no topo de cada cartão, e a lista dele é pequena o bastante pra não precisar
  // filtrar por ela.
  const ehMotorista = currentUser && currentUser.role === 'motorista';
  // "Hoje" não é a Agenda Mestra: motorista entra direto nos cartões pessoais,
  // sem período, situação ou filtros administrativos na parte superior.
  document.getElementById('agendaFilters')?.classList.toggle('hidden', ehMotorista);
  const filtroSituacaoWrap = document.getElementById('filtroSituacaoWrap');
  if (filtroSituacaoWrap) filtroSituacaoWrap.classList.toggle('hidden', ehMotorista);
  if (ehMotorista) { const fs = document.getElementById('filtroSituacao'); if (fs) fs.value = ''; }

  const filtered = filterAgenda();
  const tbody = document.getElementById('agendaTable');
  const cardsWrapVazio = document.getElementById('agendaCardsList');

  if (ehMotorista) {
    const subtitulo = document.getElementById('pageSubtitle');
    if (subtitulo) {
      if (motoristaHojeUsaProximaData && motoristaHojeDataExibida) {
        const dataFormatada = new Date(`${motoristaHojeDataExibida}T00:00`).toLocaleDateString('pt-BR', {
          weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
        });
        subtitulo.textContent = `Próxima escala: ${dataFormatada}`;
      } else {
        subtitulo.textContent = 'Suas viagens de hoje, por horário de saída';
      }
    }
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="text-center py-8 text-slate-500 text-sm">Nenhuma viagem encontrada</td></tr>';
    if (cardsWrapVazio) cardsWrapVazio.innerHTML = '<div class="text-center py-8 text-slate-500 text-sm bg-white border rounded-lg">Nenhuma viagem encontrada</div>';
    return;
  }

  const role = currentUser.role;
  // A Pedagogia não altera mais nada direto na Agenda - ela só replica o que o Admin fez
  // e mostra a validação pedagógica; o parecer de verdade agora é dado na tela "Validações".
  const podeEditarSituacao = role === 'admin' || (role === 'operacional' && canEditScreen('agenda'));
  const podeEditarOperacional = role === 'admin' || (role === 'operacional' && canEditScreen('agenda'));
  const isAgendaEditor = podeEditarOperacional;

  const cardsWrap = document.getElementById('agendaCardsList');
  const linhas = filtered
    .sort((a, b) => (a.trip_date + a.departure_time).localeCompare(b.trip_date + b.departure_time))
    .map((a) => {
      const turnoLabel = TURNO_LABELS[a.turno || turnoFromHora(a.departure_time)] || '-';
      const podeCancelar = a.situacao !== 'cancelada' && a.situacao !== 'reprovada' && a.status !== 'completed'
        && (role === 'admin' || (role === 'escola' && a.school_id === currentUser.schoolId));

      let acoes = '<span class="text-slate-300 text-xs">—</span>';
      if (a.status === 'pending' && isAgendaEditor) {
        acoes = `
          <button onclick="pedagogyApprove('${a.id}')" class="text-emerald-600 hover:text-emerald-800 text-xs font-medium mr-3">Aprovar (Pedagogia)</button>
          <button onclick="openRejectModal('${a.id}')" class="text-red-600 hover:text-red-800 text-xs font-medium">Recusar</button>`;
      } else if (a.status === 'pending' && role === 'pedagogia') {
        acoes = `<span class="text-xs text-blue-600" title="O parecer agora é dado na tela Validações">📋 Ver em Validações</span>`;
      } else if (a.status === 'pedagogy_approved' && isAgendaEditor) {
        acoes = `<button onclick="openAssignModal('${a.id}')" class="text-emerald-600 hover:text-emerald-800 text-xs font-medium">Aprovar e atribuir motorista(s)</button>`;
      } else if (a.status === 'approved' && (isAgendaEditor || (role === 'motorista' && (a.driver_ids || []).includes(currentUser.driverId)))) {
        acoes = `<button onclick="startTransit('${a.id}')" class="text-blue-600 hover:text-blue-800 text-xs font-medium">Iniciar viagem</button>`;
        if (isAgendaEditor) acoes += ` <button onclick="openAssignModal('${a.id}')" class="text-slate-500 hover:text-slate-700 text-xs font-medium ml-2">Editar motorista(s)</button>`;
      } else if (a.status === 'in_transit' && (isAgendaEditor || (role === 'motorista' && (a.driver_ids || []).includes(currentUser.driverId)))) {
        acoes = `<button onclick="completeTrip('${a.id}')" class="text-slate-700 hover:text-slate-900 text-xs font-medium">Concluir viagem</button>`;
      } else if (a.status === 'rejected' && a.rejection_reason) {
        acoes = `<span class="text-xs text-red-500" title="${a.rejection_reason}">Motivo ⓘ</span>`;
      } else if (a.situacao === 'cancelada' && a.cancel_reason) {
        acoes = `<span class="text-xs text-orange-500" title="${a.cancel_reason}">Cancelada ⓘ</span>`;
      }
      if (podeCancelar) {
        const cancelBtn = `<button onclick="openCancelModal('${a.id}')" class="text-orange-600 hover:text-orange-800 text-xs font-medium ml-2">Cancelar</button>`;
        acoes = acoes.includes('text-slate-300') ? cancelBtn : acoes + cancelBtn;
      }

      // A listagem só é cobrada depois que a viagem passou pelas duas validações (pedagogia
      // + admin/gestor) - nem todo pedido é aceito, então não faz sentido pedir a listagem
      // antes disso. "Validada" aqui = admin já atribuiu motorista (status vira "approved").
      const validadaCompletamente = viagemValidadaCompletamente(a);
      const precisaCoop = precisaCooperativa(a);
      const podeVerListagem = validadaCompletamente
        && (role === 'admin' || (role === 'escola' && a.school_id === currentUser.schoolId));
      const ehSolicitacaoExterna = a.solicitation_type === 'agendamento' || !a.school_id;
      if (validadaCompletamente && role === 'admin' && ehSolicitacaoExterna) {
        if (a.requester_email) {
          const extLabel = a.passenger_access_status === 'aberto' ? '🔗 Reenviar link' : (a.passenger_access_status === 'enviado' ? '👥 Revisar passageiros' : '🔗 Cadastro externo');
          const extBtn = `<button onclick="prepararLinkPassageiros('${a.id}')" class="text-indigo-600 hover:text-indigo-800 text-xs font-medium ml-2" title="${a.passenger_access_notified_at ? `Último envio: ${new Date(a.passenger_access_notified_at).toLocaleString('pt-BR')}` : 'Enviar link para a entidade cadastrar passageiros'}">${extLabel}</button>`;
          acoes = acoes.includes('text-slate-300') ? extBtn : acoes + extBtn;
        }
        const verListaBtn = `<button onclick="openPassengerModal('${a.id}')" class="text-slate-600 hover:text-slate-800 text-xs font-medium ml-2" title="Visualizar cadastro de passageiros">👥 Passageiros</button>`;
        acoes = acoes.includes('text-slate-300') ? verListaBtn : acoes + verListaBtn;
      }
      if (podeVerListagem && !ehSolicitacaoExterna) {
        if (precisaCoop) {
          // Viagem pra fora de Nova Lima (ou com aluno PCD) e já com motorista(s)/veículo(s)
          // atribuído(s) -> listagem por veículo, com envio pro Drive e conferência do gestor
          // antes de seguir pra cooperativa (fluxo novo).
          const statusListagem = a.listagem_status || 'nao_enviada';
          let listaLabel = '📋 Listagem';
          if (role === 'escola') {
            listaLabel = statusListagem === 'nao_enviada' ? '📋 Preencher listagem'
              : statusListagem === 'rejeitada' ? '📋 Corrigir listagem'
              : statusListagem === 'enviada' ? '📋 Listagem (enviada)'
              : '📋 Listagem (aceita)';
          } else if (role === 'admin' && statusListagem === 'enviada') {
            listaLabel = '📋 Revisar listagem 🔔';
          }
          const listaBtn = `<button onclick="openListagemVeiculoModal('${a.id}')" class="text-slate-500 hover:text-slate-700 text-xs font-medium ml-2" title="Listagem de passageiros por veículo (nome + documento)">${listaLabel}</button>`;
          acoes = acoes.includes('text-slate-300') ? listaBtn : acoes + listaBtn;
        } else {
          // Viagem dentro de Nova Lima sem PCD - continua com a listagem simples de sempre.
          const listaBtn = `<button onclick="openPassengerModal('${a.id}')" class="text-slate-500 hover:text-slate-700 text-xs font-medium ml-2" title="Listagem de passageiros (nome + CI/CNH/CPF)">📋 Lista</button>`;
          acoes = acoes.includes('text-slate-300') ? listaBtn : acoes + listaBtn;
        }
      }
      if (isAgendaEditor && validadaCompletamente && precisaCoop) {
        const coopBtn = a.envio_coop_data
          ? `<button onclick="openCooperativaEmailModal('${a.id}')" class="text-blue-600 hover:text-blue-800 text-xs font-medium ml-2" title="Enviado em ${new Date(a.envio_coop_data + 'T00:00').toLocaleDateString('pt-BR')} - clique para reenviar">✉️ Reenviar</button>`
          : `<button onclick="openCooperativaEmailModal('${a.id}')" class="text-blue-600 hover:text-blue-800 text-xs font-medium ml-2">✉️ Cooperativa</button>`;
        acoes = acoes.includes('text-slate-300') ? coopBtn : acoes + coopBtn;
      }
      if (role === 'admin' && validadaCompletamente && (a.pca_count || 0) > 0) {
        const pcdBtn = a.pcd_lista_conferida_em
          ? `<span class="ml-2 text-xs text-emerald-700">✅ PCD conferida</span>`
          : `<button onclick="conferirListaPcd('${a.id}')" class="ml-2 text-xs text-indigo-600 hover:text-indigo-800">📋 Conferir PCD</button>`;
        acoes = acoes.includes('text-slate-300') ? pcdBtn : acoes + pcdBtn;
      }

      if (isAgendaEditor) {
        const editBtn = `<button onclick="openExcursionEditor('${a.id}')" class="text-blue-600 hover:text-blue-800 text-xs font-medium ml-2" title="Editar todos os dados da viagem">✏️ Editar</button>`;
        const delBtn = `<button onclick="openDeleteExcursionModal('${a.id}')" class="text-red-600 hover:text-red-800 text-xs font-medium ml-2" title="Excluir permanentemente (diferente de Cancelar)">🗑️ Excluir</button>`;
        acoes = acoes.includes('text-slate-300') ? editBtn + delBtn : acoes + editBtn + delBtn;
      }
      if (role === 'escola' && a.school_id === currentUser.schoolId && a.recurrence_group_id && a.situacao !== 'cancelada' && a.status !== 'rejected') {
        const addDateBtn = `<button onclick="openAddRecurrenceDateModal('${a.id}')" class="text-emerald-700 hover:text-emerald-900 text-xs font-medium ml-2" title="Criar outra data nesta recorrência">＋ Data</button>`;
        acoes = acoes.includes('text-slate-300') ? addDateBtn : acoes + addDateBtn;
      }

      const situacaoCell = podeEditarSituacao
        ? `<select onchange="updateSituacao('${a.id}', this.value)" style="${SITUACAO_COLORS[a.situacao] || ''}" class="px-2 py-1 rounded text-xs font-medium border-0">
            ${Object.entries(SITUACAO_LABELS).map(([v, l]) => `<option value="${v}" ${a.situacao === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>`
        : `<span style="${SITUACAO_COLORS[a.situacao] || ''}" class="px-2 py-1 rounded text-xs font-medium">${SITUACAO_LABELS[a.situacao] || a.situacao}</span>`;

      const atfCell = podeEditarOperacional
        ? `<select onchange="updateAtf('${a.id}', this.value)" style="${ATF_COLORS[a.atf_status] || ''}" class="px-2 py-1 rounded text-xs font-medium border-0">
            ${Object.entries(ATF_LABELS).map(([v, l]) => `<option value="${v}" ${a.atf_status === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>`
        : `<span style="${ATF_COLORS[a.atf_status] || ''}" class="px-2 py-1 rounded text-xs font-medium">${ATF_LABELS[a.atf_status] || a.atf_status}</span>`;

      const dt = (value) => value ? new Date(value).toLocaleDateString('pt-BR') : '';
      const exigeAtf = precisaListagemComNomesDocumentos(a);
      const exigePcd = (a.pca_count || 0) > 0;
      const listaEscolaCell = [
        exigeAtf ? `<div class="text-xs">ATF: ${a.atf_lista_enviada_em ? dt(a.atf_lista_enviada_em) : '—'}</div>` : '',
        exigePcd ? `<div class="text-xs">PCD: ${a.pcd_lista_enviada_em ? dt(a.pcd_lista_enviada_em) : '—'}</div>` : '',
      ].filter(Boolean).join('') || '—';
      const conferenciaCell = [
        exigeAtf ? `<div class="text-xs">ATF ${a.atf_lista_conferida_em ? '✅ ' + dt(a.atf_lista_conferida_em) : '—'}</div>` : '',
        exigePcd ? `<div class="text-xs">PCD ${a.pcd_lista_conferida_em ? '✅ ' + dt(a.pcd_lista_conferida_em) : '—'}</div>` : '',
      ].filter(Boolean).join('') || '—';
      const envioCoopCell = [
        exigeAtf ? `<div class="text-xs">ATF: ${a.atf_cooperativa_enviado_em ? dt(a.atf_cooperativa_enviado_em) : '—'}</div>` : '',
        exigePcd ? `<div class="text-xs">PCD: ${a.pcd_cooperativa_enviado_em ? dt(a.pcd_cooperativa_enviado_em) : '—'}</div>` : '',
      ].filter(Boolean).join('') || '—';

      const totalPax = totalPassengers(a);
      const dataFmt = new Date(a.trip_date + 'T00:00').toLocaleDateString('pt-BR');
      const diaSemana = new Date(a.trip_date + 'T00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
      const temAcoes = !acoes.includes('text-slate-300');
      const motoristaVinculado = ehMotorista && (a.driver_ids || []).includes(currentUser.driverId);
      const outros = ehMotorista
        ? (a.driver_ids || []).filter((id) => id !== currentUser.driverId).map((id) => drivers.find((d) => d.id === id)).filter(Boolean)
        : [];
      const compartilhadaHtml = outros.map((d) => {
        const v = driverVehicle(d.id);
        return `${escapeHtml(d.name)}${d.phone ? ` • ${escapeHtml(d.phone)}` : ''}${v?.plate ? ` • ${escapeHtml(v.plate)}` : ''}`;
      }).join('<br>');
      const viagensIndicadas = motoristaVinculado ? numeroViagensIndicadas(a) : 1;

      const tr = `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-sm">
        <div class="font-medium">${dataFmt}</div>
        <div class="text-xs text-slate-500 capitalize">${diaSemana}</div>
        <div class="text-xs font-medium text-slate-600">${turnoLabel}</div>
      </td>
      <td class="px-4 py-3 text-sm">${hhmm(a.departure_time)}</td>
      <td class="px-4 py-3 text-sm">${hhmm(a.return_time)}</td>
      <td class="px-4 py-3 text-sm">
        <div>${originName(a)}</div>
        <div class="text-xs text-slate-500">${originAddress(a) || '-'}</div>
      </td>
      <td class="px-4 py-3 text-sm">
        <div>${a.destination}</div>
        <div class="text-xs text-slate-500">${a.destination_address || a.city || '-'}</div>
      </td>
      <td class="px-4 py-3 text-sm">
        <div class="font-medium">${totalPax} total</div>
        <div class="text-xs text-slate-500">${a.students_count || 0} alunos + ${a.companions_count || 0} acomp.${a.pca_count ? ` • ${a.pca_count} PCD + ${a.apoio_count || 0} apoio (veículo adaptado)` : ''}</div>
      </td>
      <td class="px-4 py-3 text-xs text-slate-500">
        <div>${a.created_at ? new Date(a.created_at).toLocaleDateString('pt-BR') : '-'}</div>
        <div>${a.requester_name || '-'}</div>
      </td>
      <td class="px-4 py-3 text-xs text-slate-500">
        <div>${a.pedagogy_approved_at ? new Date(a.pedagogy_approved_at).toLocaleDateString('pt-BR') : '-'}</div>
        <div class="font-medium text-slate-700">${validatorFullName(a.pedagogy_approved_by)}</div>
      </td>
      <td class="px-4 py-3">${atfCell}</td>
      <td class="px-4 py-3">${situacaoCell}</td>
      <td class="px-4 py-3 text-xs">${driversLabelHtml(a.driver_ids)}</td>
      <td class="px-4 py-3 whitespace-nowrap">${acoes}</td>
      <td class="px-4 py-3 text-sm text-center">${listaEscolaCell}</td>
      <td class="px-4 py-3 text-sm text-center">${conferenciaCell}</td>
      <td class="px-4 py-3 text-sm">${envioCoopCell}</td>
    </tr>`;

      // Cartão pro celular (mesmas informações da tabela, só que empilhadas em vez de
      // lado a lado) - segue o mesmo modelo de planilha que os motoristas já usam hoje:
      // Data/Turno, Saída/Retorno, Origem, Destino, Passageiros, ATF e Motorista(s) em
      // destaque; Situação como selo colorido no topo; as mesmas ações de sempre embaixo.
      const card = `
    <div class="${ehMotorista ? 'driver-trip-card' : 'border'} rounded-lg overflow-hidden bg-white shadow-sm">
      <div class="px-4 py-2.5 flex items-center justify-between gap-2 bg-slate-50 border-b border-slate-100">
        <div class="text-sm">
          <span class="font-semibold">${dataFmt}</span>
          <span class="text-slate-500"> • ${turnoLabel}</span>
        </div>
        ${situacaoCell}
      </div>
      <div class="p-4 space-y-2.5 text-sm">
        <div class="flex items-center justify-between gap-2">
          <span class="text-slate-500 text-xs">Saída → Retorno</span>
          <span class="font-bold text-base text-slate-800">${horaComH(a.departure_time)} → ${horaComH(a.return_time)}</span>
        </div>
        <div>
          <div class="text-slate-500 text-xs">Origem</div>
          <div class="font-medium">${originName(a)}</div>
          <div class="text-xs text-slate-500">${originAddress(a) || '-'}</div>
        </div>
        <div>
          <div class="text-slate-500 text-xs">Destino</div>
          <div class="font-medium">${a.destination}</div>
          <div class="text-xs text-slate-500">${a.destination_address || a.city || '-'}</div>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-slate-500 text-xs">Passageiros</span>
          <span class="font-medium">${totalPax} total</span>
        </div>
        ${motoristaVinculado ? `<div class="rounded-lg bg-emerald-50 px-3 py-2 text-left text-sm font-bold text-emerald-800">Número de viagens: ${String(viagensIndicadas).padStart(2, '0')}</div>` : ''}
        <div class="flex items-center justify-between gap-2">
          <span class="text-slate-500 text-xs">ATF</span>
          ${atfCell}
        </div>
        ${!ehMotorista ? `<div class="flex items-center justify-between gap-2">
          <span class="text-slate-500 text-xs">Motorista(s)</span>
          <span class="text-right">${driversLabelHtml(a.driver_ids)}</span>
        </div>` : ''}
        ${ehMotorista ? `<div class="text-xs text-slate-600"><span class="text-slate-400">Solicitante:</span> ${escapeHtml(a.requester_name || schoolName(a.school_id) || '-')} ${requesterContact(a) ? `• ${escapeHtml(requesterContact(a))}` : ''}</div>` : ''}
        ${ehMotorista && compartilhadaHtml ? `<div class="text-xs text-slate-600 bg-slate-50 rounded p-2"><span class="text-slate-400">Viagem compartilhada:</span><br>${compartilhadaHtml}</div>` : ''}
      </div>
      ${temAcoes ? `<div class="px-4 py-3 border-t border-slate-100 bg-slate-50 flex flex-wrap gap-x-1 gap-y-2">${acoes}</div>` : ''}
    </div>`;

      return { tr, card };
    });
  tbody.innerHTML = linhas.map((l) => l.tr).join('');
  if (cardsWrap) cardsWrap.innerHTML = linhas.map((l) => l.card).join('');
}

// ============ AGENDA POR DATA (Motorista) - semana inteira OU hoje + próximos 3 dias ============
// Resolve o problema de "sexta-feira sem saber a agenda de segunda": a Agenda normal
// (Minhas Viagens) e o filtro "semana" ali são presos à semana de calendário
// (domingo-sábado), então numa sexta a "semana" acaba na própria sexta. Aqui a opção
// "Hoje + 3 dias" é uma janela móvel a partir de hoje - numa sexta ela sempre alcança
// a segunda-feira seguinte.
let agendaPorDataModo = 'proximos';

function setAgendaPorDataModo(modo) {
  agendaPorDataModo = modo;
  renderAgendaPorData();
}

function renderAgendaPorData() {
  const btnSemana = document.getElementById('btnAgendaDataSemana');
  const btnProximos = document.getElementById('btnAgendaDataProximos');
  if (btnSemana && btnProximos) {
    btnSemana.className = 'px-3 py-1.5 rounded-md font-medium ' + (agendaPorDataModo === 'semana' ? 'bg-white shadow text-emerald-700' : 'text-slate-500');
    btnProximos.className = 'px-3 py-1.5 rounded-md font-medium ' + (agendaPorDataModo === 'proximos' ? 'bg-white shadow text-emerald-700' : 'text-slate-500');
  }

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  let start, end;
  if (agendaPorDataModo === 'semana') {
    start = new Date(hoje); start.setDate(hoje.getDate() - hoje.getDay());
    end = new Date(start); end.setDate(start.getDate() + 6);
  } else {
    start = new Date(hoje);
    end = new Date(hoje); end.setDate(hoje.getDate() + 3);
  }
  const startStr = fmtDate(start);
  const endStr = fmtDate(end);
  const hojeStr = fmtDate(hoje);

  // "Minhas próximas viagens" é pessoal: apenas viagens confirmadas do motorista
  // logado. A visão de todos os motoristas está em Agenda Geral.
  const fonte = currentUser?.role === 'motorista'
    ? agenda.filter((a) => viagemConfirmadaParaMotorista(a) && (a.driver_ids || []).includes(currentUser.driverId))
    : getVisibleAgenda();
  const visiveis = fonte.filter((a) => a.trip_date >= startStr && a.trip_date <= endStr && a.situacao !== 'cancelada' && a.situacao !== 'reprovada');
  const porDia = {};
  visiveis.forEach((a) => { (porDia[a.trip_date] = porDia[a.trip_date] || []).push(a); });

  const dias = [];
  const cursor = new Date(start);
  while (cursor <= end) { dias.push(fmtDate(cursor)); cursor.setDate(cursor.getDate() + 1); }

  const container = document.getElementById('agendaPorDataLista');
  if (!container) return;
  container.innerHTML = dias.map((dataStr) => {
    const trips = (porDia[dataStr] || []).slice().sort((a, b) => (a.departure_time || '').localeCompare(b.departure_time || ''));
    const dObj = new Date(dataStr + 'T00:00');
    const diaSemana = dObj.toLocaleDateString('pt-BR', { weekday: 'long' });
    const dataFmt = dObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const isHoje = dataStr === hojeStr;
    return `
      <div class="border rounded-lg overflow-hidden ${isHoje ? 'border-emerald-300' : 'border-slate-200'}">
        <div class="px-4 py-2 flex items-center justify-between ${isHoje ? 'bg-emerald-50' : 'bg-slate-50'}">
          <div class="font-semibold text-sm capitalize">${diaSemana} <span class="text-slate-500 font-normal">- ${dataFmt}</span>${isHoje ? ' <span class="ml-1 text-xs bg-emerald-600 text-white px-2 py-0.5 rounded-full">Hoje</span>' : ''}</div>
          <div class="text-xs text-slate-500">${trips.length ? trips.length + ' viagem(ns)' : 'sem viagens'}</div>
        </div>
        <div class="divide-y divide-slate-100">
          ${trips.length ? trips.map(renderAgendaPorDataItem).join('') : '<div class="px-4 py-3 text-sm text-slate-400">Nenhuma viagem atribuída</div>'}
        </div>
      </div>`;
  }).join('');
}

function renderAgendaPorDataItem(a, agendaGeral = false) {
  let acao = '';
  if (a.status === 'approved') acao = `<button onclick="startTransit('${a.id}')" class="text-blue-600 hover:text-blue-800 text-xs font-medium whitespace-nowrap">Iniciar viagem</button>`;
  else if (a.status === 'in_transit') acao = `<button onclick="completeTrip('${a.id}')" class="text-slate-700 hover:text-slate-900 text-xs font-medium whitespace-nowrap">Concluir viagem</button>`;
  const totalPax = totalPassengers(a);
  const minhaViagem = currentUser?.role === 'motorista' && (a.driver_ids || []).includes(currentUser.driverId);
  const outros = !agendaGeral && currentUser?.role === 'motorista'
    ? (a.driver_ids || []).filter((id) => id !== currentUser.driverId).map((id) => drivers.find((d) => d.id === id)).filter(Boolean)
    : [];
  const compartilhadaHtml = outros.map((d) => {
    const v = driverVehicle(d.id);
    return `${escapeHtml(d.name)}${d.phone ? ` • ${escapeHtml(d.phone)}` : ''}${v?.plate ? ` • ${escapeHtml(v.plate)}` : ''}`;
  }).join('<br>');
  const numeroViagens = minhaViagem ? numeroViagensIndicadas(a) : 1;
  return `
    <div class="driver-trip-card px-4 py-4 flex items-center justify-between gap-3 bg-white rounded-xl mb-3">
      <div>
        <div class="font-medium text-sm">${originName(a)} → ${a.destination}</div>
        <div class="font-bold text-sm text-slate-700">${horaComH(a.departure_time)} → ${horaComH(a.return_time)} <span class="font-normal text-xs text-slate-500">• ${totalPax} passageiros SEMED</span></div>
        <div class="text-xs text-slate-500 mt-1">${originAddress(a) || '-'}</div>
        <div class="text-xs text-slate-500 mt-1">${a.destination_address || a.city || '-'}</div>
        ${agendaGeral ? `<div class="text-xs text-slate-700 mt-2"><span class="text-slate-400">Motorista(s) escalado(s):</span> ${driversLabelHtml(a.driver_ids)}</div>` : ''}
        ${minhaViagem ? `<div class="mt-2 inline-flex rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">Número de viagens: ${String(numeroViagens).padStart(2, '0')}</div>` : ''}
        ${currentUser?.role === 'motorista' ? `<div class="text-xs text-slate-600 mt-1">Solicitante: ${escapeHtml(a.requester_name || schoolName(a.school_id) || '-')}${requesterContact(a) ? ` • ${escapeHtml(requesterContact(a))}` : ''}</div>` : ''}
        ${compartilhadaHtml ? `<div class="text-xs text-slate-600 mt-1">Compartilhada com:<br>${compartilhadaHtml}</div>` : ''}
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span style="${SITUACAO_COLORS[a.situacao] || ''}" class="px-2 py-1 rounded text-xs font-medium">${SITUACAO_LABELS[a.situacao] || a.situacao}</span>
        ${minhaViagem ? acao : ''}
      </div>
    </div>`;
}

let editExcursionId = null;
function openExcursionEditor(id) {
  if (currentUser?.role !== 'admin') return;
  const trip = agenda.find((a) => a.id === id); if (!trip) return;
  editExcursionId = id;
  const set = (field, value) => { const el = document.getElementById(field); if (el) el.value = value ?? ''; };
  set('editTripDate', trip.trip_date); set('editDepartureTime', hhmm(trip.departure_time)); set('editReturnTime', hhmm(trip.return_time));
  set('editOriginName', originName(trip)); set('editOriginAddress', originAddress(trip)); set('editOriginCity', originCity(trip));
  set('editDestination', trip.destination); set('editDestinationAddress', trip.destination_address); set('editCity', trip.city);
  set('editStudentsCount', trip.students_count || 0); set('editCompanionsCount', trip.companions_count || 0); set('editRequesterContact', trip.requester_contact); set('editNotes', trip.notes);
  document.getElementById('editSituacao').innerHTML = Object.entries(SITUACAO_LABELS).map(([v, l]) => `<option value="${v}" ${trip.situacao === v ? 'selected' : ''}>${l}</option>`).join('');
  document.getElementById('editAtfStatus').innerHTML = Object.entries(ATF_LABELS).map(([v, l]) => `<option value="${v}" ${trip.atf_status === v ? 'selected' : ''}>${l}</option>`).join('');
  document.getElementById('excursionEditorModal').classList.remove('hidden');
}

let agendaGeralModo = 'proximos';
function setAgendaGeralModo(modo) { agendaGeralModo = modo; renderAgendaGeralMotorista(); }

function renderAgendaGeralMotorista() {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const inicio = fmtDate(hoje);
  const fimData = new Date(hoje);
  if (agendaGeralModo === 'proximos') fimData.setDate(fimData.getDate() + 3);
  const fim = fmtDate(fimData);
  const hojeBtn = document.getElementById('btnAgendaGeralHoje');
  const proximosBtn = document.getElementById('btnAgendaGeralProximos');
  if (hojeBtn) hojeBtn.className = 'px-3 py-1.5 rounded-md font-medium ' + (agendaGeralModo === 'hoje' ? 'bg-white shadow text-emerald-700' : 'text-slate-500');
  if (proximosBtn) proximosBtn.className = 'px-3 py-1.5 rounded-md font-medium ' + (agendaGeralModo === 'proximos' ? 'bg-white shadow text-emerald-700' : 'text-slate-500');
  const viagens = agenda.filter((a) => viagemConfirmadaParaMotorista(a) && a.trip_date >= inicio && a.trip_date <= fim)
    .sort((a, b) => (a.trip_date + (a.departure_time || '')).localeCompare(b.trip_date + (b.departure_time || '')));
  const porDia = {};
  viagens.forEach((a) => { (porDia[a.trip_date] ||= []).push(a); });
  const container = document.getElementById('agendaGeralLista');
  if (!container) return;
  const dias = Object.keys(porDia).sort();
  container.innerHTML = dias.length ? dias.map((data) => {
    const d = new Date(data + 'T00:00');
    const rotulo = d.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'2-digit' });
    return `<div class="border rounded-xl overflow-hidden"><div class="px-4 py-3 bg-slate-50 border-b flex justify-between"><strong class="capitalize">${rotulo}</strong><span class="text-xs text-slate-500">${porDia[data].length} viagem(ns)</span></div><div class="p-3">${porDia[data].map((a) => renderAgendaPorDataItem(a, true)).join('')}</div></div>`;
  }).join('') : '<p class="text-center text-sm text-slate-500 py-8">Nenhuma viagem confirmada neste período.</p>';
}
function closeExcursionEditor() { document.getElementById('excursionEditorModal').classList.add('hidden'); editExcursionId = null; }
async function saveExcursionEditor() {
  if (!editExcursionId || currentUser?.role !== 'admin') return;
  const v = (id) => document.getElementById(id).value;
  const patch = { trip_date:v('editTripDate'), departure_time:v('editDepartureTime')||null, return_time:v('editReturnTime')||null, origin_name:v('editOriginName').trim()||null, origin_address:v('editOriginAddress').trim()||null, origin_city:v('editOriginCity').trim()||null, destination:v('editDestination').trim(), destination_address:v('editDestinationAddress').trim()||null, city:v('editCity').trim()||null, students_count:parseInt(v('editStudentsCount'),10)||0, companions_count:parseInt(v('editCompanionsCount'),10)||0, situacao:v('editSituacao'), atf_status:v('editAtfStatus'), requester_contact:v('editRequesterContact').trim()||null, notes:v('editNotes').trim()||null };
  if (!patch.trip_date || !patch.destination) { toast('⚠️ Informe data e destino.', true); return; }
  if (!await updateExcursion(editExcursionId, patch)) return;
  await loadAgenda(); renderAgenda(); renderDashboard(); closeExcursionEditor(); toast('✅ Viagem atualizada.');
}

async function updateSituacao(id, value) {
  const ok = await updateExcursion(id, { situacao: value });
  if (ok) { await loadAgenda(); renderAgenda(); renderDashboard(); }
}

async function updateAtf(id, value) {
  const ok = await updateExcursion(id, { atf_status: value });
  if (ok) {
    const trip = agenda.find((a) => a.id === id);
    if (trip && value === 'emitida') await notifyAssignedDrivers(trip, 'ATF emitida', `A ATF da viagem para ${trip.destination || '-'} foi confirmada como emitida.`);
    if (trip && value === 'nao_emitida') await notifyAssignedDrivers(trip, 'ATF solicitada', `A ATF da viagem para ${trip.destination || '-'} está pendente de emissão.`);
    await loadAgenda(); await loadNotifications(); renderAgenda();
  }

  const semValidacao = visible.filter((a) => a.situacao === 'sem_validacao' && a.status === 'pending');
  const semValidacaoBox = document.getElementById('dashboardSemValidacao');
  const semValidacaoLista = document.getElementById('dashboardSemValidacaoLista');
  if (semValidacaoBox) semValidacaoBox.classList.toggle('hidden', currentUser?.role !== 'pedagogia');
  if (semValidacaoLista && currentUser?.role === 'pedagogia') {
    semValidacaoLista.innerHTML = semValidacao.slice(0, 6).map((a) => `<button onclick="openValidacaoModal('${a.id}')" class="text-left bg-white/70 hover:bg-white rounded-lg px-3 py-2 text-sm"><strong>${originName(a)}</strong> → ${a.destination}<span class="text-slate-500"> • ${a.trip_date ? new Date(a.trip_date + 'T00:00').toLocaleDateString('pt-BR') : '-'}</span></button>`).join('') || '<p class="text-sm text-amber-800">Nenhuma validação pendente.</p>';
  }

  const dashboardValidacoes = document.getElementById('dashboardValidacoes');
  const listaAValidar = document.getElementById('dashboardAValidarLista');
  const listaValidadas = document.getElementById('dashboardValidadasLista');
  const mostraRelacao = ['admin', 'pedagogia'].includes(currentUser?.role);
  if (dashboardValidacoes) dashboardValidacoes.classList.toggle('hidden', !mostraRelacao);
  const renderLinhaValidacao = (a) => `<button onclick="${a.status === 'pending' && currentUser?.role === 'pedagogia' ? `openValidacaoModal('${a.id}')` : `showScreen('agenda')`}" class="w-full text-left rounded-lg bg-white/75 hover:bg-white px-3 py-2 text-sm"><strong>${originName(a)}</strong> → ${a.destination}<span class="block text-xs text-slate-500">${a.trip_date ? new Date(a.trip_date + 'T00:00').toLocaleDateString('pt-BR') : '-'} • ${publicoAlvoLabel(a.validation_target_id || a.publico_alvo)}</span></button>`;
  if (mostraRelacao && listaAValidar && listaValidadas) {
    const aValidar = visible.filter((a) => a.status === 'pending' && a.situacao === 'sem_validacao');
    const validadas = visible.filter((a) => a.status !== 'pending' || ['aceito','correcoes','rejeitado'].includes(a.doc_status));
    listaAValidar.innerHTML = aValidar.slice(0, 8).map(renderLinhaValidacao).join('') || '<p class="text-sm text-amber-800">Nenhuma solicitação pendente.</p>';
    listaValidadas.innerHTML = validadas.slice(0, 8).map(renderLinhaValidacao).join('') || '<p class="text-sm text-emerald-800">Nenhuma solicitação validada no filtro.</p>';
  }
}

async function updateExcursionField(id, field, value) {
  const ok = await updateExcursion(id, { [field]: value });
  if (ok) { await loadAgenda(); renderAgenda(); }
}

async function updateExcursion(id, patch) {
  // Qualquer gravação efetiva feita pelo Admin (editar, aprovar, recusar, atribuir
  // etc.) encerra a pendência inicial da ocorrência. Apenas abrir a Agenda não chama
  // esta função, portanto não remove item algum da fila.
  if (currentUser?.role === 'admin' && !patch.admin_processed_at) {
    patch = { ...patch, admin_processed_at: new Date().toISOString(), admin_processed_by: currentUser.id };
  }
  if (sb) {
    const { error } = await sb.from('excursions').update(patch).eq('id', id);
    if (error) { toast('❌ Erro ao atualizar: ' + error.message, true); return false; }
  } else {
    const v = agenda.find((a) => a.id === id);
    if (v) { Object.assign(v, patch); saveDemoData(); }
  }
  return true;
}

function pendenciaDataHora(a) {
  const data = a.trip_date ? new Date(`${a.trip_date}T00:00`).toLocaleDateString('pt-BR') : 'sem data';
  const criado = a.created_at ? new Date(a.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  return `${data}${a.departure_time ? ` • ${horaComH(a.departure_time)}` : ''}${criado ? ` · solicitado em ${criado}` : ''}`;
}

function pendenciaCard(a, { badge, tone = 'amber', detail = '', action = '' } = {}) {
  const toneClasses = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    red: 'border-red-200 bg-red-50 text-red-800',
  };
  return `<article class="rounded-xl border bg-white p-4 shadow-sm border-l-4 ${toneClasses[tone] || toneClasses.amber}">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2"><span class="rounded-full px-2 py-0.5 text-xs font-bold ${toneClasses[tone] || toneClasses.amber}">${escapeHtml(badge || 'Pendente')}</span><span class="text-xs text-slate-500">${pendenciaDataHora(a)}</span></div>
        <h3 class="mt-2 font-bold text-slate-800">${escapeHtml(originName(a))} <span class="text-slate-400">→</span> ${escapeHtml(a.destination || '-')}</h3>
        <p class="mt-1 text-sm text-slate-600">${escapeHtml(a.requester_name || schoolName(a.school_id) || 'Solicitante não identificado')} · ${totalPassengers(a)} passageiros</p>
        <p class="mt-1 text-xs text-slate-500">${escapeHtml(originAddress(a) || '-') } → ${escapeHtml(a.destination_address || a.city || '-')}</p>
        ${detail ? `<p class="mt-2 text-xs font-medium text-slate-600">${detail}</p>` : ''}
      </div>
      ${action}
    </div>
  </article>`;
}

function pendenciaBloco(titulo, subtitulo, cards, icon, tone) {
  const colors = { emerald: 'text-emerald-700', amber: 'text-amber-700', blue: 'text-blue-700', red: 'text-red-700' };
  return `<section class="rounded-xl border bg-white p-4 shadow-sm">
    <div class="mb-3 flex items-center justify-between gap-3"><div><h2 class="font-bold ${colors[tone] || colors.amber}">${icon} ${titulo}</h2><p class="text-xs text-slate-500 mt-0.5">${subtitulo}</p></div><span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">${cards.length}</span></div>
    <div class="space-y-3">${cards.length ? cards.join('') : '<p class="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-400">Nenhum item nesta fila.</p>'}</div>
  </section>`;
}

function abrirAgendaDaPendencia(data) {
  const filtroData = document.getElementById('filtroData');
  const filtroPeriodo = document.getElementById('filtroPeriodo');
  const filtroSituacao = document.getElementById('filtroSituacao');
  if (filtroData) filtroData.value = data || '';
  if (filtroPeriodo) filtroPeriodo.value = 'dia';
  if (filtroSituacao) filtroSituacao.value = '';
  showScreen('agenda');
}

function renderPendencias() {
  const container = document.getElementById('pendenciasLista');
  if (!container || !['admin', 'pedagogia'].includes(currentUser?.role)) return;
  const ehAdmin = currentUser.role === 'admin';
  const recentes = agenda.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const abertas = recentes.filter((a) => !['cancelada', 'reprovada'].includes(a.situacao) && a.status !== 'rejected');
  const semValidacao = abertas.filter((a) => a.status === 'pending' && a.situacao === 'sem_validacao');
  const reenvio = abertas.filter((a) => a.doc_status === 'correcoes');
  const botaoAgenda = (a) => ehAdmin ? `<button onclick="abrirAgendaDaPendencia('${a.trip_date}')" class="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700">Abrir agenda da data</button>` : '';

  const introTitulo = document.getElementById('pendenciasIntroTitulo');
  const introTexto = document.getElementById('pendenciasIntroTexto');
  if (introTitulo) introTitulo.textContent = ehAdmin ? 'Fila de tratativas administrativas' : 'Acompanhamento pedagógico (somente consulta)';
  if (introTexto) introTexto.textContent = ehAdmin
    ? 'Um item novo sai da fila inicial somente depois que o Admin salva uma tratativa na Agenda.'
    : 'Indicadores das solicitações que ainda aguardam análise ou documentação pedagógica.';

  if (ehAdmin) {
    // Viagens já aprovadas, em rota ou concluídas são históricas: mesmo nas bases
    // antigas (sem admin_processed_at preenchido) elas não podem voltar à fila.
    const novas = abertas.filter((a) => !a.admin_processed_at && ['pending', 'pedagogy_approved'].includes(a.status));
    const canceladasPelaUnidade = recentes.filter((a) => a.situacao === 'cancelada' && a.cancelled_by && a.cancelled_by === a.created_by);
    container.innerHTML = [
      pendenciaBloco('Novas solicitações', 'Aguardando a primeira tratativa do Admin.', novas.map((a) => pendenciaCard(a, { badge: 'Nova solicitação', tone: 'emerald', action: botaoAgenda(a) })), '🚌', 'emerald'),
      pendenciaBloco('Sem validação pedagógica', 'Solicitações que ainda não receberam parecer pedagógico.', semValidacao.map((a) => pendenciaCard(a, { badge: 'Aguardando validação', tone: 'amber', action: botaoAgenda(a) })), '⏳', 'amber'),
      pendenciaBloco('Reenvio de proposta pendente', 'A Pedagogia pediu correções e aguarda novo arquivo da unidade.', reenvio.map((a) => pendenciaCard(a, { badge: 'Aguardando reenvio', tone: 'blue', detail: escapeHtml(a.doc_parecer_comentario || 'Proposta pedagógica devolvida para correção.'), action: botaoAgenda(a) })), '📄', 'blue'),
      pendenciaBloco('Canceladas pela unidade', 'Também chegam como notificação para o Admin e o motorista.', canceladasPelaUnidade.map((a) => pendenciaCard(a, { badge: 'Cancelada pela unidade', tone: 'red', detail: escapeHtml(a.cancel_reason || 'Sem motivo informado.') })), '🚫', 'red'),
    ].join('');
  } else {
    const naoVerificadas = abertas.filter((a) => !a.pedagogy_approved_at && a.status === 'pending');
    container.innerHTML = [
      pendenciaBloco('Solicitações ainda não verificadas', 'Em ordem de criação; indicador sem ações administrativas.', naoVerificadas.map((a) => pendenciaCard(a, { badge: 'Aguardando Pedagogia', tone: 'amber' })), '📥', 'amber'),
      pendenciaBloco('Sem validação pedagógica', 'Solicitações pendentes de parecer pedagógico.', semValidacao.map((a) => pendenciaCard(a, { badge: 'Sem validação', tone: 'amber' })), '⏳', 'amber'),
      pendenciaBloco('Reenvio de proposta pendente', 'A unidade ainda não enviou a versão corrigida do documento.', reenvio.map((a) => pendenciaCard(a, { badge: 'Aguardando reenvio', tone: 'blue', detail: escapeHtml(a.doc_parecer_comentario || 'Proposta pedagógica devolvida para correção.') })), '📄', 'blue'),
    ].join('');
  }
}

// Quando a viagem faz parte de uma série recorrente (recurrence_group_id), aprovar
// a primeira ocorrência aprova a série inteira. Recusar/cancelar fica sempre por linha.
async function updateExcursionCascade(id, patch) {
  const trip = agenda.find((a) => a.id === id);
  const groupId = trip && trip.recurrence_group_id;
  if (!groupId) return updateExcursion(id, patch);

  if (currentUser?.role === 'admin' && !patch.admin_processed_at) {
    patch = { ...patch, admin_processed_at: new Date().toISOString(), admin_processed_by: currentUser.id };
  }

  if (sb) {
    const { error } = await sb.from('excursions').update(patch).eq('recurrence_group_id', groupId);
    if (error) { toast('❌ Erro ao atualizar: ' + error.message, true); return false; }
  } else {
    agenda.filter((a) => a.recurrence_group_id === groupId).forEach((a) => Object.assign(a, patch));
    saveDemoData();
  }
  return true;
}

async function pedagogyApprove(id) {
  const trip = agenda.find((a) => a.id === id);
  const precisaAtf = trip && precisaListagemComNomesDocumentos(trip);
  const ok = await updateExcursionCascade(id, {
    status: 'pedagogy_approved',
    pedagogy_approved_by: currentUser.id,
    pedagogy_approved_at: new Date().toISOString(),
    situacao: precisaAtf ? 'aguarda_atf' : 'aprovada',
    atf_status: precisaAtf ? 'nao_emitida' : 'nao_precisa',
    // Este botão é um atalho direto do Admin (bypassa a tela Validações) - mesmo assim
    // marca o parecer documental como aceito, pra escola/pedagogia verem tudo coerente.
    doc_status: 'aceito',
    doc_parecer_por: currentUser.id,
    doc_parecer_em: new Date().toISOString(),
  });
  if (!ok) return;
  await loadAgenda(); renderAgenda(); renderDashboard();
  toast(trip && trip.recurrence_group_id
    ? '✅ Viagem aprovada pela pedagogia - toda a série recorrente foi validada junto!'
    : '✅ Viagem aprovada pela pedagogia! Aguardando aprovação final do admin.');
}

const REJECT_REASONS = ['Falta de dados', 'Fora do calendário letivo', 'Falta de veículo/motorista disponível', 'Documentação pendente', 'Outro'];
const CANCEL_REASONS = ['Não haverá mais a viagem', 'Mudança de data', 'Outro'];

function onMotivoSelectChange(selectId, outroId) {
  document.getElementById(outroId).classList.toggle('hidden', document.getElementById(selectId).value !== 'Outro');
}

function openRejectModal(id) {
  rejectTargetId = id;
  document.getElementById('rejectMotivoSelect').value = REJECT_REASONS[0];
  document.getElementById('rejectMotivoOutro').value = '';
  document.getElementById('rejectMotivoOutro').classList.add('hidden');
  document.getElementById('rejectModal').classList.remove('hidden');
}
function closeRejectModal() { document.getElementById('rejectModal').classList.add('hidden'); rejectTargetId = null; }
async function confirmReject() {
  const escolhido = document.getElementById('rejectMotivoSelect').value;
  const motivo = escolhido === 'Outro' ? (document.getElementById('rejectMotivoOutro').value.trim() || 'Outro') : escolhido;
  const ok = await updateExcursion(rejectTargetId, {
    status: 'rejected', rejection_reason: motivo, situacao: 'reprovada',
    doc_status: 'rejeitado', doc_parecer_comentario: motivo, doc_parecer_por: currentUser.id, doc_parecer_em: new Date().toISOString(),
  });
  if (ok) { await loadAgenda(); renderAgenda(); renderDashboard(); toast('🚫 Solicitação recusada.'); }
  closeRejectModal();
}

function openCancelModal(id) {
  cancelTargetId = id;
  document.getElementById('cancelMotivoSelect').value = CANCEL_REASONS[0];
  document.getElementById('cancelMotivoOutro').value = '';
  document.getElementById('cancelMotivoOutro').classList.add('hidden');
  document.getElementById('cancelModal').classList.remove('hidden');
}
function closeCancelModal() { document.getElementById('cancelModal').classList.add('hidden'); cancelTargetId = null; }
async function confirmCancel() {
  const trip = agenda.find((a) => a.id === cancelTargetId);
  const escolhido = document.getElementById('cancelMotivoSelect').value;
  const motivo = escolhido === 'Outro' ? (document.getElementById('cancelMotivoOutro').value.trim() || 'Outro') : escolhido;
  const ok = await updateExcursion(cancelTargetId, {
    situacao: 'cancelada', cancel_reason: motivo, cancelled_by: currentUser.id, cancelled_at: new Date().toISOString(),
  });
  if (ok) {
    if (trip) {
      const data = trip.trip_date ? new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR') : '-';
      await notifyAssignedDrivers(trip, 'CANCELADA!', `${data} - ${originName(trip)} - ${hhmm(trip.departure_time)}H → ${hhmm(trip.return_time)}H`);
    }
    await loadAgenda(); await loadNotifications(); renderAgenda(); renderDashboard(); toast('🚫 Viagem cancelada.');
  }
  closeCancelModal();
}

// Exclusão de verdade (hard delete), diferente de "Cancelar" (que só muda a situação e
// mantém a viagem no histórico). Só é oferecida aqui, na Agenda Mestra, porque excursions
// é a única tabela do sistema em que isso é seguro: todo o histórico que depende de uma
// viagem (passageiros, listagens, comentários de validação etc.) está configurado no banco
// com "on delete cascade", ou seja, some junto - não há risco de ficar lixo órfão nem de
// violar chave estrangeira. Em Usuários/Motoristas/Veículos/Cooperativas/Unidades o banco
// recusaria (ou apagaria histórico de forma irreversível), por isso lá o app usa
// Bloquear/Reativar em vez de excluir de verdade.
let deleteExcursionTargetId = null;
function openDeleteExcursionModal(id) {
  deleteExcursionTargetId = id;
  const trip = agenda.find((a) => a.id === id);
  const info = document.getElementById('deleteExcursionInfo');
  if (info) {
    info.textContent = trip
      ? `${trip.destination} - ${new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR')} (${schoolName(trip.school_id)})`
      : '';
  }
  document.getElementById('deleteExcursionModal').classList.remove('hidden');
}
function closeDeleteExcursionModal() {
  document.getElementById('deleteExcursionModal').classList.add('hidden');
  deleteExcursionTargetId = null;
}
async function confirmDeleteExcursion() {
  const id = deleteExcursionTargetId;
  if (!id) return;
  if (sb) {
    const { error } = await sb.from('excursions').delete().eq('id', id);
    if (error) { toast('❌ Erro ao excluir: ' + error.message, true); return; }
  } else {
    const idx = agenda.findIndex((a) => a.id === id);
    if (idx !== -1) { agenda.splice(idx, 1); saveDemoData(); }
  }
  await loadAgenda();
  renderAgenda();
  renderDashboard();
  toast('🗑️ Viagem excluída permanentemente.');
  closeDeleteExcursionModal();
}

// ============ VALIDAÇÕES (Escola envia o projeto pedagógico, Pedagogia dá o parecer) ============
function populateValidacaoOrigemFilter() {
  const sel = document.getElementById('validacaoFiltroOrigem');
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todas as origens</option>'
    + schools.filter((s) => s.tipo !== 'entidade').map((s) => `<option value="${s.id}">${s.name}</option>`).join('')
    + '<option value="__OUTROS__">Entidade / Outro</option>';
  sel.value = atual;
}

async function openValidacoesScreen() {
  await loadValidationConfig();
  const isEscola = currentUser.role === 'escola';
  const escolaBox = document.getElementById('validacoesEscola');
  const pedagogiaBox = document.getElementById('validacoesPedagogia');
  if (escolaBox) escolaBox.classList.toggle('hidden', !isEscola);
  if (pedagogiaBox) pedagogiaBox.classList.toggle('hidden', isEscola);

  if (isEscola) {
    populateValidacaoDestinoEscolaFilter();
    renderValidacoesEscola();
  } else {
    // Por padrão, mostra primeiro o setor da própria pessoa (se ela tiver um definido em
    // "Usuários") - mas ela pode trocar pra "Todos" ou outro setor a qualquer momento.
    const sel = document.getElementById('validacaoFiltroSetor');
    if (sel && validationSectors.length) {
      const anterior = sel.value;
      sel.innerHTML = '<option value="">Meus setores</option>' + validationSectors.filter((s) => s.active !== false).map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
      sel.value = validationSectors.some((s) => s.id === anterior) ? anterior : '';
    }
    if (sel && !sel.dataset.inited) {
      sel.value = currentUser.setorPedagogico || '';
      sel.dataset.inited = '1';
    }
    renderValidacoesPedagogia();
  }
}

function populateValidacaoDestinoEscolaFilter() {
  const sel = document.getElementById('validacaoFiltroDestinoEscola');
  if (!sel) return;
  const atual = sel.value;
  const destinos = [...new Set(getVisibleAgenda().filter((a) => a.school_id === currentUser.schoolId).map((a) => String(a.destination || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  sel.innerHTML = '<option value="">Todos os destinos</option>' + destinos.map((d) => `<option value="${String(d).replace(/\"/g,'&quot;')}">${d}</option>`).join('');
  sel.value = destinos.includes(atual) ? atual : '';
}

async function atualizarValidacoesEscola() {
  await loadSchools();
  await loadAgenda();
  populateValidacaoDestinoEscolaFilter();
  renderValidacoesEscola();
  toast('🔄 Validações atualizadas.');
}

function renderValidacoesEscola() {
  const tbody = document.getElementById('validacoesEscolaTable');
  if (!tbody) return;
  const destinoFiltro = document.getElementById('validacaoFiltroDestinoEscola')?.value || '';
  const dataFiltro = document.getElementById('validacaoFiltroDataEscola')?.value || '';
  let minhas = getVisibleAgenda().filter((a) => a.school_id === currentUser.schoolId);
  if (destinoFiltro) minhas = minhas.filter((a) => (a.destination || '') === destinoFiltro);
  if (dataFiltro) minhas = minhas.filter((a) => (a.trip_date || '') === dataFiltro);
  if (minhas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-500 text-sm">Nenhuma solicitação encontrada</td></tr>';
    return;
  }
  tbody.innerHTML = minhas
    .slice()
    .sort((a, b) => (b.trip_date || '').localeCompare(a.trip_date || ''))
    .map((a) => {
      const podeEnviar = a.status === 'pending' && (a.doc_status === 'nao_enviado' || a.doc_status === 'correcoes');
      const btnLabel = a.doc_status === 'nao_enviado' ? '📎 Anexar' : '📎 Reenviar';
      // Sempre mostra o nome completo de quem deu o parecer (não só o comentário) - fica
      // claro pra escola quem exatamente aprovou/pediu correção/rejeitou.
      const parecerPorTxt = a.doc_parecer_por ? ` <span class="text-slate-500">— ${validatorFullName(a.doc_parecer_por)}</span>` : '';
      let parecerCell = '<span class="text-xs text-slate-400">—</span>';
      if (a.doc_status === 'correcoes' && a.doc_parecer_comentario) {
        parecerCell = `<span class="text-xs text-amber-700">✏️ ${a.doc_parecer_comentario}${parecerPorTxt}</span>`;
      } else if (a.doc_status === 'rejeitado' && a.doc_parecer_comentario) {
        parecerCell = `<span class="text-xs text-red-700">🚫 ${a.doc_parecer_comentario}${parecerPorTxt}</span>`;
      } else if (a.doc_status === 'aceito') {
        parecerCell = `<span class="text-xs text-emerald-700">✅ Aprovado${parecerPorTxt}</span>`;
      }
      return `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-sm">${new Date(a.trip_date + 'T00:00').toLocaleDateString('pt-BR')}</td>
      <td class="px-4 py-3 text-sm">${originName(a)}<div class="text-xs text-slate-500">${originAddress(a) || '-'}<div class="text-xs text-slate-400">${originCity(a) || ''}</div></div></td>
      <td class="px-4 py-3 text-sm">${a.destination}<div class="text-xs text-slate-500">${a.destination_address || a.city || '-'}</div></td>
      <td class="px-4 py-3 text-sm">${publicoAlvoLabel(a.validation_target_id || a.publico_alvo)}</td>
      <td class="px-4 py-3 text-sm">
        <span style="${DOC_STATUS_COLORS[a.doc_status] || ''}" class="px-2 py-1 rounded text-xs font-medium">${DOC_STATUS_LABELS[a.doc_status] || a.doc_status}</span>
        ${a.doc_filename ? `<div class="text-xs text-slate-400 mt-1">${a.doc_filename}</div>` : ''}
      </td>
      <td class="px-4 py-3">${parecerCell}</td>
      <td class="px-4 py-3 text-sm">
        ${podeEnviar ? `<button onclick="openDocUploadModal('${a.id}')" class="text-xs text-emerald-600 hover:text-emerald-800">${btnLabel}</button>` : ''}
        ${a.status === 'approved' && (a.driver_ids || []).length && precisaListagemComNomesDocumentos(a) ? `<button onclick="openListagemVeiculoModal('${a.id}')" class="ml-2 text-xs text-indigo-600 hover:text-indigo-800">📋 ${a.listagem_status === 'rejeitada' ? 'Corrigir listagem' : 'Passageiros'}</button>` : ''}
        ${!podeEnviar && !(a.status === 'approved' && (a.driver_ids || []).length && precisaListagemComNomesDocumentos(a)) ? '<span class="text-slate-300 text-xs">—</span>' : ''}
      </td>
    </tr>`;
    }).join('');
}

async function atualizarValidacoesPedagogia() {
  await loadSchools();
  await loadAgenda();
  populateValidacaoOrigemFilter();
  renderValidacoesPedagogia();
  toast('🔄 Validações atualizadas.');
}

function renderValidacoesPedagogia() {
  const tbody = document.getElementById('validacoesPedagogiaTable');
  if (!tbody) return;
  const setorEl = document.getElementById('validacaoFiltroSetor');
  const origemEl = document.getElementById('validacaoFiltroOrigem');
  const setorFiltro = setorEl ? setorEl.value : '';
  const origemFiltro = origemEl ? origemEl.value : '';
  const meusSetores = new Set(validatorSectorAssignments.filter((v) => v.profile_id === currentUser?.id).map((v) => v.sector_id));
  let lista = agenda.filter((a) => a.status === 'pending');
  if (validationSectors.length) {
    lista = lista.filter((a) => setorFiltro ? a.validation_sector_id === setorFiltro : (!meusSetores.size || meusSetores.has(a.validation_sector_id)));
  } else if (setorFiltro) lista = lista.filter((a) => a.setor_pedagogico_atual === setorFiltro);
  if (origemFiltro) lista = lista.filter((a) => origemFiltroId(a) === origemFiltro);

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-500 text-sm">Nenhuma solicitação pendente de validação</td></tr>';
    return;
  }
  const podeEditarValidacao = currentUser?.role === 'pedagogia' || (currentUser?.role === 'operacional' && canEditScreen('validacoes'));
  tbody.innerHTML = lista
    .slice()
    .sort((a, b) => (a.trip_date || '').localeCompare(b.trip_date || ''))
    .map((a) => {
      const totalPax = (a.students_count || 0) + (a.companions_count || 0) + (a.pca_count || 0) + (a.apoio_count || 0);
      return `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-sm">${new Date(a.trip_date + 'T00:00').toLocaleDateString('pt-BR')}</td>
      <td class="px-4 py-3 text-sm">${originName(a)}<div class="text-xs text-slate-500">${originAddress(a) || '-'}</div></td>
      <td class="px-4 py-3 text-sm">${a.destination}<div class="text-xs text-slate-500">${a.destination_address || a.city || '-'}</div></td>
      <td class="px-4 py-3 text-sm">${publicoAlvoLabel(a.validation_target_id || a.publico_alvo)}</td>
      <td class="px-4 py-3 text-sm">${totalPax}</td>
      <td class="px-4 py-3 text-sm">${validationSectors.find((s) => s.id === a.validation_sector_id)?.name || SETOR_PEDAGOGICO_LABELS[a.setor_pedagogico_atual] || '-'}</td>
      <td class="px-4 py-3 text-sm"><span style="${DOC_STATUS_COLORS[a.doc_status] || ''}" class="px-2 py-1 rounded text-xs font-medium">${DOC_STATUS_LABELS[a.doc_status] || a.doc_status}</span></td>
      <td class="px-4 py-3 text-sm"><button onclick="openValidacaoModal('${a.id}')" class="text-xs text-emerald-600 hover:text-emerald-800">📋 ${podeEditarValidacao ? 'Analisar' : 'Consultar'}</button></td>
    </tr>`;
    }).join('');
}

// ---- upload do documento (Escola) ----
let docUploadTargetId = null;

function slugify(text) {
  return (text || 'unidade').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unidade';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function logDocHistory(excursionId, evento, setorOrigem, setorDestino, comentario, tipo) {
  if (sb) {
    await sb.from('excursion_doc_history').insert([{
      excursion_id: excursionId, evento, setor_origem: setorOrigem || null, setor_destino: setorDestino || null,
      comentario: comentario || null, por: currentUser.id, tipo: tipo || 'documento',
    }]);
  }
  // Modo demo: não crítico manter o histórico persistente entre sessões - ignoramos aqui.
}

function openDocUploadModal(id) {
  docUploadTargetId = id;
  const trip = agenda.find((a) => a.id === id);
  if (!trip) return;
  document.getElementById('docUploadInfo').textContent = `${trip.destination} - ${new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR')}`;
  const box = document.getElementById('docUploadCorrecaoBox');
  if (trip.doc_status === 'correcoes' && trip.doc_parecer_comentario) {
    box.textContent = '✏️ A Pedagogia pediu correções: ' + trip.doc_parecer_comentario;
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
  document.getElementById('docFileInput').value = '';
  document.getElementById('docUploadModal').classList.remove('hidden');
}
function closeDocUploadModal() { document.getElementById('docUploadModal').classList.add('hidden'); docUploadTargetId = null; }

async function confirmUploadDoc() {
  if (!docUploadTargetId) return;
  const trip = agenda.find((a) => a.id === docUploadTargetId);
  if (!trip) return;
  const fileInput = document.getElementById('docFileInput');
  const file = fileInput.files[0];
  if (!file) { toast('⚠️ Escolha um arquivo antes de enviar.', true); return; }

  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
  const unidadeSlug = slugify(schoolName(trip.school_id) || trip.requester_name);
  const filename = `${trip.id}_${trip.trip_date}_${unidadeSlug}.${ext}`;
  const driveUrl = getDriveUploadUrl();

  let docPatch = { doc_filename: filename };
  if (driveUrl) {
    try {
      const base64 = await fileToBase64(file);
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.access_token) throw new Error('Sua sessão expirou. Entre novamente antes de enviar o documento.');
      const resp = await fetch(driveUrl, {
        method: 'POST',
        body: JSON.stringify({
          excursionId: trip.id,
          filename,
          mimeType: file.type,
          fileBase64: base64,
          accessToken: session.access_token,
        }),
      });
      const respJson = await resp.json();
      if (!respJson.ok) throw new Error(respJson.error || 'Falha no upload');
      docPatch.doc_drive_file_id = respJson.fileId || null;
      docPatch.doc_drive_url = respJson.url || null;
    } catch (err) {
      toast('❌ Erro ao enviar pro Google Drive: ' + (err && err.message ? err.message : err), true);
      return;
    }
  } else {
    toast('⚠️ Google Drive ainda não configurado (peça pro Admin configurar em Cooperativas) - arquivo registrado só localmente.', true);
  }

  const wasReenvio = !!(trip.doc_status && trip.doc_status !== 'nao_enviado');
  const ok = await updateExcursion(docUploadTargetId, {
    ...docPatch,
    doc_uploaded_at: new Date().toISOString(),
    doc_status: 'em_analise',
    doc_parecer_comentario: null,
  });
  if (!ok) return;
  await logDocHistory(docUploadTargetId, wasReenvio ? 'reenviado' : 'enviado', null, trip.setor_pedagogico_atual, null);
  await loadAgenda();
  renderValidacoesEscola();
  toast('✅ Documento enviado para análise da Pedagogia.');
  closeDocUploadModal();
}

// ---- parecer + encaminhamento (Pedagogia) ----
let validacaoTargetId = null;

function openValidacaoModal(id) {
  validacaoTargetId = id;
  const trip = agenda.find((a) => a.id === id);
  if (!trip) return;
  const meusSetores = new Set(validatorSectorAssignments.filter((v) => v.profile_id === currentUser?.id).map((v) => v.sector_id));
  if (currentUser?.role === 'pedagogia' && validationSectors.length && meusSetores.size && !meusSetores.has(trip.validation_sector_id)) {
    toast('⚠️ Esta validação está vinculada a outro setor.', true); return;
  }
  // O transporte adaptado PCD é pedido à parte à cooperativa; portanto não entra na
  // lotação/ATF do veículo regular escalado pela Secretaria.
  const totalPax = (trip.students_count || 0) + (trip.companions_count || 0);
  document.getElementById('validacaoInfo').innerHTML = `
    <div><strong>Origem:</strong> ${originName(trip)}</div>
    <div><strong>Endereço da origem:</strong> ${originAddress(trip) || '-'}</div>
    <div><strong>Destino:</strong> ${trip.destination} (${trip.city || '-'})</div>
    <div><strong>Data:</strong> ${new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR')}</div>
    <div><strong>Pessoas:</strong> ${totalPax}</div>
    <div><strong>Público-alvo:</strong> ${publicoAlvoLabel(trip.validation_target_id || trip.publico_alvo)}</div>
    <div><strong>Setor atual:</strong> ${validationSectors.find((s) => s.id === trip.validation_sector_id)?.name || SETOR_PEDAGOGICO_LABELS[trip.setor_pedagogico_atual] || '-'}</div>
    ${trip.doc_parecer_por ? `<div class="col-span-2"><strong>Última análise por:</strong> ${validatorFullName(trip.doc_parecer_por)}${trip.doc_parecer_em ? ' em ' + new Date(trip.doc_parecer_em).toLocaleDateString('pt-BR') : ''}</div>` : ''}
  `;
  const preview = document.getElementById('validacaoDocPreview');
  if (trip.doc_drive_url) {
    preview.innerHTML = `<iframe src="${trip.doc_drive_url}" style="width:100%;height:62vh;min-height:520px;border:0"></iframe>`;
  } else if (trip.doc_filename) {
    preview.innerHTML = `<div class="p-4 text-sm text-slate-500">📄 ${trip.doc_filename}<br/><span class="text-xs">Google Drive não configurado ainda - documento registrado só localmente, sem pré-visualização.</span></div>`;
  } else {
    preview.innerHTML = '<div class="p-4 text-sm text-slate-500">Nenhum documento enviado ainda.</div>';
  }
  document.getElementById('parecerSelect').value = 'aceito';
  document.getElementById('parecerComentario').value = '';
  const encaminhar = document.getElementById('encaminharSetor');
  if (validationSectors.length) {
    encaminhar.innerHTML = validationSectors.filter((s) => s.active !== false).map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    encaminhar.value = trip.validation_sector_id || validationSectors[0]?.id || '';
  } else encaminhar.value = trip.setor_pedagogico_atual || 'administracao';
  const somenteConsulta = currentUser?.role === 'operacional' && !canEditScreen('validacoes');
  document.getElementById('parecerSelect').disabled = somenteConsulta;
  document.getElementById('parecerComentario').disabled = somenteConsulta;
  document.getElementById('encaminharSetor').disabled = somenteConsulta;
  document.getElementById('btnSalvarParecer').hidden = somenteConsulta;
  document.getElementById('btnEncaminharValidacao').hidden = somenteConsulta;
  document.getElementById('validacaoModal').classList.remove('hidden');
}
function closeValidacaoModal() { document.getElementById('validacaoModal').classList.add('hidden'); validacaoTargetId = null; }

async function confirmParecer() {
  if (currentUser?.role === 'operacional' && !canEditScreen('validacoes')) { toast('⚠️ Seu perfil permite apenas consultar validações.', true); return; }
  const id = validacaoTargetId;
  if (!id) return;
  const trip = agenda.find((a) => a.id === id);
  if (!trip) return;
  const parecer = document.getElementById('parecerSelect').value; // 'aceito' | 'correcoes' | 'rejeitado'
  const comentario = document.getElementById('parecerComentario').value.trim();
  if (parecer !== 'aceito' && !comentario) {
    toast('⚠️ Informe o comentário explicando a correção/rejeição.', true); return;
  }

  const docPatch = {
    doc_status: parecer,
    doc_parecer_comentario: comentario || null,
    doc_parecer_por: currentUser.id,
    doc_parecer_em: new Date().toISOString(),
  };

  let ok;
  if (parecer === 'aceito') {
    const precisaAtf = trip.city && !trip.city.toLowerCase().includes('nova lima');
    ok = await updateExcursionCascade(id, {
      ...docPatch,
      status: 'pedagogy_approved',
      pedagogy_approved_by: currentUser.id,
      pedagogy_approved_at: new Date().toISOString(),
      situacao: precisaAtf ? 'aguarda_atf' : 'aprovada',
      atf_status: precisaAtf ? 'nao_emitida' : 'nao_precisa',
    });
  } else if (parecer === 'rejeitado') {
    ok = await updateExcursion(id, { ...docPatch, status: 'rejected', situacao: 'reprovada', rejection_reason: comentario });
  } else {
    ok = await updateExcursion(id, docPatch); // correções: mantém "pending", só registra o parecer pra escola reenviar
  }
  if (!ok) return;

  await logDocHistory(id, parecer, trip.setor_pedagogico_atual, trip.setor_pedagogico_atual, comentario || null);
  await loadAgenda();
  renderValidacoesPedagogia();
  renderDashboard();
  toast(parecer === 'aceito' ? '✅ Solicitação aprovada pedagogicamente!' : parecer === 'rejeitado' ? '🚫 Solicitação rejeitada.' : '✏️ Correções solicitadas à unidade.');
  closeValidacaoModal();
}

async function confirmEncaminhar() {
  if (currentUser?.role === 'operacional' && !canEditScreen('validacoes')) { toast('⚠️ Seu perfil permite apenas consultar validações.', true); return; }
  const id = validacaoTargetId;
  if (!id) return;
  const trip = agenda.find((a) => a.id === id);
  if (!trip) return;
  const destino = document.getElementById('encaminharSetor').value;
  const setorAtual = validationSectors.length ? trip.validation_sector_id : trip.setor_pedagogico_atual;
  if (destino === setorAtual) { toast('⚠️ Esse já é o setor atual.', true); return; }
  const ok = await updateExcursion(id, validationSectors.length ? { validation_sector_id: destino } : { setor_pedagogico_atual: destino });
  if (!ok) return;
  await logDocHistory(id, 'encaminhado', trip.setor_pedagogico_atual, destino, null);
  await loadAgenda();
  renderValidacoesPedagogia();
  toast('↪️ Encaminhado para ' + (validationSectors.find((s) => s.id === destino)?.name || SETOR_PEDAGOGICO_LABELS[destino] || destino) + '.');
  closeValidacaoModal();
}

// ============ ACESSO EXTERNO PARA PASSAGEIROS ============
function viagemExigeListaCompleta(trip) {
  return cidadeEhForaDeNovaLima(trip?.city) || cidadeEhForaDeNovaLima(originCity(trip));
}
function passageiroPortalUrl(token) {
  return `${window.location.origin}${window.location.pathname.replace(/[^/]+$/, '')}passageiros.html?token=${encodeURIComponent(token)}`;
}
function gerarTokenAcessoPassageiros() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Este navegador não oferece geração segura de link. Use um navegador atualizado.');
}
async function prepararLinkPassageiros(id) {
  if (currentUser?.role !== 'admin') return;
  const trip = agenda.find((a) => a.id === id);
  if (!trip) return;
  if (!viagemValidadaCompletamente(trip)) { toast('⚠️ O link só pode ser liberado depois da aprovação e atribuição do motorista.', true); return; }
  if (!trip.requester_email) { toast('⚠️ Esta solicitação não possui e-mail da entidade externa/origem. Cadastre o e-mail na solicitação.', true); return; }
  let token = trip.passenger_access_token;
  if (!token) token = gerarTokenAcessoPassageiros();
  const patch = {
    passenger_access_token: token,
    passenger_access_status: 'aberto',
    passenger_access_submitted_at: null,
    passenger_access_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  if (sb) {
    const { error } = await sb.from('excursions').update(patch).eq('id', id);
    if (error) { toast('❌ Erro ao liberar cadastro externo: ' + error.message, true); return; }
  } else { Object.assign(trip, patch); saveDemoData(); }
  await loadAgenda();
  const url = passageiroPortalUrl(token);
  const assunto = `Cadastro de passageiros - ${trip.destination} - ${new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR')}`;
  const corpo = `Olá!\n\nSua solicitação de transporte foi aprovada e o cadastro de passageiros deve ser preenchido pelo link abaixo:\n\n${url}\n\nQuantidade máxima: conforme a capacidade dos veículos atribuídos. Não é obrigatório preencher toda a capacidade.\n\nPreencha nome completo, tipo e número do documento de cada passageiro.\n\nAtenciosamente,\nBora Lá – Excursões`;
  const enviado = await tentarEnviarEmailAutomatico(trip.requester_email, assunto, corpo);
  if (enviado) {
    await updateExcursion(id, { passenger_access_notified_at: new Date().toISOString() });
    await loadAgenda();
    toast('✉️ Link de cadastro enviado por e-mail.'); 
  } else {
    window.location.href = `mailto:${encodeURIComponent(trip.requester_email)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
    toast('✉️ Não foi possível enviar automaticamente; foi aberto um rascunho de e-mail.');
  }
}
async function reabrirCadastroPassageiros(id) {
  if (currentUser?.role !== 'admin') return;
  const trip = agenda.find((a) => a.id === id);
  if (!trip?.passenger_access_token) return;
  const patch = { passenger_access_status: 'aberto', passenger_access_submitted_at: null };
  const ok = await updateExcursion(id, patch);
  if (ok) { await loadAgenda(); renderAgenda(); toast('🔓 Cadastro de passageiros reaberto.'); }
}

// ============ LISTAGEM DE PASSAGEIROS (nome + CI/CNH/CPF, pra ATF) ============
async function openPassengerModal(id) {
  passengerModalExcursionId = id;
  passengerModalReviewMode = currentUser?.role === 'admin' && (() => { const t = agenda.find(a => a.id === id); return t && (t.solicitation_type === 'agendamento' || !t.school_id) && t.passenger_access_status === 'enviado'; })();
  const trip = agenda.find((a) => a.id === id);
  if (sb) {
    const { data } = await sb.from('excursion_passengers').select('*').eq('excursion_id', id).order('created_at');
    passengerRows = (data || []).map((p) => ({ nome: p.nome, documento: p.documento || '', tipo_documento: p.tipo_documento || 'cpf' }));
  } else {
    passengerRows = ((trip && trip.passengers) || []).map((p) => ({ ...p }));
  }
  if (passengerRows.length === 0) passengerRows.push({ nome: '', documento: '', tipo_documento: 'cpf' });
  renderPassengerRows();
  const footer = document.getElementById('passengerModalFooter');
  if (footer) {
    footer.innerHTML = passengerModalReviewMode
      ? `<button onclick="closePassengerModal()" class="px-4 py-2 bg-slate-100 rounded-lg text-sm">Fechar</button>
         <button onclick="rejeitarPassengerPortal()" class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm">🚫 Devolver para correção</button>
         <button onclick="aprovarPassengerPortal()" class="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">✅ Aprovar e enviar</button>`
      : `<button onclick="closePassengerModal()" class="px-4 py-2 bg-slate-100 rounded-lg text-sm">Cancelar</button>
         <button onclick="confirmSavePassengers()" class="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">Salvar</button>`;
  }
  document.getElementById('passengerModal').classList.remove('hidden');
}
function closePassengerModal() { document.getElementById('passengerModal').classList.add('hidden'); passengerModalExcursionId = null; passengerModalReviewMode = false; }
async function aprovarPassengerPortal() {
  if (!passengerModalExcursionId || !passengerModalReviewMode) return;
  const id = passengerModalExcursionId, trip = agenda.find(a => a.id === id);
  const rows = passengerRows.filter(p => p.nome && p.nome.trim()).map(p => ({ ...p, driver_id: p.driver_id || (trip.driver_ids || [])[0] || null }));
  const capacidade = totalCapacity(trip.driver_ids || []);
  if (!rows.length) { toast('⚠️ A lista está vazia.', true); return; }
  if (rows.length > capacidade) { toast(`⚠️ A lista ultrapassa a capacidade total (${capacidade}).`, true); return; }
  if (precisaListagemComNomesDocumentos(trip) && rows.some(p => !p.nome.trim() || !p.documento.trim() || !p.tipo_documento)) { toast('⚠️ Nome, tipo e documento são obrigatórios.', true); return; }
  if (!await savePassengersForExcursion(id, rows)) return;
  const ok = await updateExcursion(id, { listagem_status:'aceita', passenger_access_status:'bloqueado', listagem_parecer_por:currentUser.id, listagem_parecer_em:new Date().toISOString(), listagem_parecer_comentario:null });
  if (!ok) return;
  await notifyRequester(trip, 'Listagem aprovada', 'A listagem de passageiros foi aprovada e será encaminhada à cooperativa.');
  closePassengerModal(); await loadAgenda(); await loadNotifications(); renderAgenda(); toast('✅ Listagem aprovada. Enviando para a cooperativa...'); await enviarListagemParaCooperativas(id);
}
async function rejeitarPassengerPortal() {
  if (!passengerModalExcursionId || !passengerModalReviewMode) return;
  const id = passengerModalExcursionId, trip = agenda.find(a => a.id === id);
  const motivo = (window.prompt('Informe o motivo da devolução para correção:') || '').trim();
  if (!motivo) return;
  const ok = await updateExcursion(id, { listagem_status:'rejeitada', passenger_access_status:'aberto', listagem_parecer_por:currentUser.id, listagem_parecer_em:new Date().toISOString(), listagem_parecer_comentario:motivo });
  if (!ok) return;
  await notifyRequester({ ...trip, listagem_parecer_comentario:motivo }, 'Listagem devolvida para correção', 'A listagem de passageiros foi devolvida para correção. Motivo: ' + motivo);
  if (trip.requester_email) await notifyRequesterEmail({ ...trip, listagem_parecer_comentario:motivo }, 'Bora Lá - correção da listagem de passageiros', buildRequesterRejectedEmail({ ...trip, listagem_parecer_comentario:motivo }));
  closePassengerModal(); await loadAgenda(); await loadNotifications(); renderAgenda(); toast('🚫 Listagem devolvida para correção.');
}
function renderPassengerRows() {
  document.getElementById('passengerRows').innerHTML = passengerRows.map((p, i) => `
    <div class="flex gap-2 items-center">
      <span class="text-xs text-slate-400 w-5 text-right">${i + 1}.</span>
      <input type="text" value="${p.nome}" placeholder="Nome do passageiro" oninput="updatePassengerField(${i}, 'nome', this.value)" class="flex-1 px-2 py-1.5 border rounded text-sm" />
      <select onchange="updatePassengerField(${i}, 'tipo_documento', this.value)" class="w-40 px-2 py-1.5 border rounded text-sm"><option value="cpf" ${(p.tipo_documento||'cpf')==='cpf'?'selected':''}>CPF</option><option value="rg" ${(p.tipo_documento||'')==='rg'?'selected':''}>RG</option><option value="certidao_nascimento" ${(p.tipo_documento||'')==='certidao_nascimento'?'selected':''}>Certidão de nascimento</option></select><input type="text" value="${p.documento || ''}" placeholder="Número do documento" oninput="updatePassengerField(${i}, 'documento', this.value)" class="w-40 px-2 py-1.5 border rounded text-sm" />
      <button onclick="removePassengerRow(${i})" class="text-slate-400 hover:text-red-600 text-sm px-1">✕</button>
    </div>`).join('');
}
function addPassengerRow() { passengerRows.push({ nome: '', documento: '', tipo_documento: 'cpf' }); renderPassengerRows(); }
function removePassengerRow(i) { passengerRows.splice(i, 1); renderPassengerRows(); }
function updatePassengerField(i, field, value) { if (passengerRows[i]) passengerRows[i][field] = value; }
// Salva (substitui) toda a listagem de passageiros de uma viagem - usado tanto pela
// listagem simples antiga (driver_id sempre null) quanto pela listagem por veículo nova
// (driver_id = motorista/veículo dono daquela linha).
async function savePassengersForExcursion(id, rows) {
  if (sb) {
    const { error: delErr } = await sb.from('excursion_passengers').delete().eq('excursion_id', id);
    if (delErr) { toast('❌ Erro ao salvar listagem: ' + delErr.message, true); return false; }
    if (rows.length) {
      const { error: insErr } = await sb.from('excursion_passengers')
        .insert(rows.map((p) => ({ excursion_id: id, nome: p.nome.trim(), tipo_documento: p.tipo_documento || 'cpf', documento: (p.documento || '').trim() || null, driver_id: p.driver_id || null })));
      if (insErr) { toast('❌ Erro ao salvar listagem: ' + insErr.message, true); return false; }
    }
  } else {
    const trip = agenda.find((a) => a.id === id);
    if (trip) { trip.passengers = rows.map((p) => ({ nome: p.nome.trim(), tipo_documento: p.tipo_documento || 'cpf', documento: (p.documento || '').trim(), driver_id: p.driver_id || null })); saveDemoData(); }
  }
  return true;
}
async function confirmSavePassengers() {
  const rows = passengerRows.filter((p) => p.nome && p.nome.trim()).map((p) => ({ ...p, driver_id: null }));
  const ok = await savePassengersForExcursion(passengerModalExcursionId, rows);
  if (!ok) return;
  closePassengerModal();
  toast('✅ Listagem de passageiros salva!');
}
async function getExcursionPassengers(id) {
  if (sb) {
    const { data } = await sb.from('excursion_passengers').select('*').eq('excursion_id', id).order('created_at');
    return (data || []).map((p) => ({ nome: p.nome, documento: p.documento || '', tipo_documento: p.tipo_documento || 'cpf' }));
  }
  const trip = agenda.find((a) => a.id === id);
  return ((trip && trip.passengers) || []).map((p) => ({ ...p }));
}
// Mesma consulta acima, mas agrupada por driver_id (veículo) - usada pela listagem por
// veículo (novo fluxo) e pelo e-mail automático pra cooperativa.
async function getExcursionPassengersGrouped(id) {
  let rows;
  if (sb) {
    const { data } = await sb.from('excursion_passengers').select('*').eq('excursion_id', id).order('created_at');
    rows = (data || []).map((p) => ({ nome: p.nome, tipo_documento: p.tipo_documento || 'cpf', documento: p.documento || '', driver_id: p.driver_id || null }));
  } else {
    const trip = agenda.find((a) => a.id === id);
    rows = ((trip && trip.passengers) || []).map((p) => ({ ...p }));
  }
  const grouped = {};
  rows.forEach((p) => {
    const key = p.driver_id || '_sem_veiculo';
    (grouped[key] = grouped[key] || []).push(p);
  });
  return grouped;
}
// No modo Supabase de verdade os alunos PCD não vêm junto do select de excursions
// (ficam na tabela à parte excursion_pcd_students) - busca sob demanda, só quando
// precisa montar o e-mail (no modo demo já vem junto em trip.pcd_students).
async function getExcursionPcdStudents(id) {
  if (sb) {
    const { data } = await sb.from('excursion_pcd_students').select('*').eq('excursion_id', id).order('created_at');
    return (data || []).map((p) => ({ nome_aluno: p.nome_aluno, cadeirante: !!p.cadeirante, nome_apoio: p.nome_apoio || '' }));
  }
  const trip = agenda.find((a) => a.id === id);
  return ((trip && trip.pcd_students) || []).map((p) => ({ ...p }));
}

// ============ LISTAGEM DE PASSAGEIROS POR VEÍCULO (viagens que precisam de cooperativa) ============
// Quando a viagem é pra fora de Nova Lima (ou tem aluno PCD) e já tem motorista(s)/veículo(s)
// atribuído(s), a escola preenche UMA listagem POR VEÍCULO (limitada à capacidade daquele
// veículo - não precisa usar a capacidade toda). Ao enviar, a listagem vai pro Google Drive
// (1 PDF por veículo) e o gestor é notificado pra conferir: aceita -> segue automaticamente
// (ou manualmente, se o e-mail automático não estiver configurado) pra cooperativa
// correspondente; rejeita -> escola é notificada e reenvia. Não há prazo/deadline nesse
// fluxo - a conferência acontece quando o gestor tiver disponibilidade.
let listagemVeiculoTargetId = null;
let listagemRowsByDriver = {}; // { [driverId]: [{ nome, tipo_documento, documento }, ...] }

async function openListagemVeiculoModal(id) {
  listagemVeiculoTargetId = id;
  const trip = agenda.find((a) => a.id === id);
  if (!trip) return;
  const driverIds = trip.driver_ids || [];
  const grouped = await getExcursionPassengersGrouped(id);
  const status = trip.listagem_status || 'nao_enviada';
  const editable = currentUser.role === 'escola' && (status === 'nao_enviada' || status === 'rejeitada');

  listagemRowsByDriver = {};
  driverIds.forEach((did) => {
    const existentes = (grouped[did] || []).map((p) => ({ nome: p.nome, tipo_documento: p.tipo_documento || 'cpf', documento: p.documento || '' }));
    listagemRowsByDriver[did] = existentes.length ? existentes : (editable ? [{ nome: '', documento: '' }] : []);
  });

  renderListagemVeiculoModal();
  document.getElementById('listagemVeiculoModal').classList.remove('hidden');
}
function closeListagemVeiculoModal() {
  document.getElementById('listagemVeiculoModal').classList.add('hidden');
  listagemVeiculoTargetId = null;
  listagemRowsByDriver = {};
}

function renderListagemVeiculoModal() {
  const id = listagemVeiculoTargetId;
  const trip = agenda.find((a) => a.id === id);
  if (!trip) return;
  const role = currentUser.role;
  const status = trip.listagem_status || 'nao_enviada';
  const editable = role === 'escola' && (status === 'nao_enviada' || status === 'rejeitada');

  document.getElementById('listagemVeiculoInfo').textContent =
    `${trip.destination} - ${new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR')} - ${(trip.driver_ids || []).length} veículo(s)`;

  let statusHtml = `<span style="${LISTAGEM_STATUS_COLORS[status] || ''}" class="px-2 py-1 rounded text-xs font-medium">${LISTAGEM_STATUS_LABELS[status] || status}</span>`;
  if (status === 'rejeitada' && trip.listagem_parecer_comentario) {
    statusHtml += `<div class="text-xs text-red-700 mt-2">🚫 ${trip.listagem_parecer_comentario} <span class="text-slate-500">— ${validatorFullName(trip.listagem_parecer_por)}</span></div>`;
  } else if (status === 'aceita') {
    statusHtml += `<div class="text-xs text-emerald-700 mt-2">✅ Aceita por ${validatorFullName(trip.listagem_parecer_por)}${trip.listagem_parecer_em ? ' em ' + new Date(trip.listagem_parecer_em).toLocaleDateString('pt-BR') : ''}</div>`;
    if (trip.cooperativa_email_sent_at) statusHtml += `<div class="text-xs text-emerald-700 mt-1">✉️ E-mail para cooperativa enviado em ${new Date(trip.cooperativa_email_sent_at).toLocaleString('pt-BR')} <button onclick="reenviarListagemParaCooperativas('${id}')" class="underline ml-1">Reenviar</button></div>`;
    else if (trip.cooperativa_email_last_error) statusHtml += `<div class="text-xs text-amber-700 mt-1">⚠️ Envio automático não concluído. <button onclick="reenviarListagemParaCooperativas('${id}')" class="underline ml-1">Tentar novamente</button></div>`;
  } else if (status === 'enviada' && trip.listagem_enviada_em) {
    statusHtml += `<div class="text-xs text-slate-500 mt-2">Enviada em ${new Date(trip.listagem_enviada_em).toLocaleDateString('pt-BR')} - aguardando conferência do gestor.</div>`;
  }
  document.getElementById('listagemStatusBox').innerHTML = statusHtml;

  const driverIds = trip.driver_ids || [];
  document.getElementById('listagemVeiculoBlocos').innerHTML = driverIds.map((did) => renderListagemVeiculoBloco(did, editable)).join('')
    || '<p class="text-sm text-slate-500">Esta viagem ainda não tem motorista/veículo atribuído.</p>';

  document.getElementById('listagemRejeitarBox').classList.add('hidden');
  document.getElementById('listagemParecerComentario').value = '';

  const footer = document.getElementById('listagemVeiculoFooter');
  let btns = `<button onclick="closeListagemVeiculoModal()" class="px-4 py-2 bg-slate-100 rounded-lg text-sm">Fechar</button>`;
  if (editable) {
    btns += `<button onclick="confirmEnviarListagem()" class="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">📤 Enviar listagem</button>`;
  } else if (role === 'admin' && status === 'enviada') {
    btns += `<button onclick="document.getElementById('listagemRejeitarBox').classList.remove('hidden')" class="px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm">🚫 Rejeitar</button>`;
    btns += `<button onclick="confirmAceitarListagem()" class="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">✅ Aceitar</button>`;
  }
  footer.innerHTML = btns;
}

function renderListagemVeiculoBloco(did, editable) {
  const v = driverVehicle(did);
  const d = drivers.find((x) => x.id === did);
  const capacidade = v ? v.capacity : 0;
  const rows = listagemRowsByDriver[did] || [];
  const preenchidos = rows.filter((p) => p.nome && p.nome.trim()).length;
  const corContagem = capacidade && preenchidos > capacidade ? 'text-red-600' : 'text-slate-500';

  const linhas = editable
    ? rows.map((p, i) => `
        <div class="flex gap-2 items-center">
          <span class="text-xs text-slate-400 w-5 text-right">${i + 1}.</span>
          <input type="text" value="${p.nome || ''}" placeholder="Nome completo" oninput="updateListagemField('${did}', ${i}, 'nome', this.value)" class="flex-1 px-2 py-1.5 border rounded text-sm" />
          <select onchange="updateListagemField('${did}', ${i}, 'tipo_documento', this.value)" class="w-36 px-2 py-1.5 border rounded text-sm">
            <option value="cpf" ${p.tipo_documento === 'cpf' ? 'selected' : ''}>CPF</option>
            <option value="rg" ${p.tipo_documento === 'rg' ? 'selected' : ''}>RG</option>
            <option value="certidao_nascimento" ${p.tipo_documento === 'certidao_nascimento' ? 'selected' : ''}>Certidão</option>
          </select>
          <input type="text" value="${p.documento || ''}" placeholder="Número" oninput="updateListagemField('${did}', ${i}, 'documento', this.value)" class="w-32 px-2 py-1.5 border rounded text-sm" />
          <button onclick="removeListagemRow('${did}', ${i})" class="text-slate-400 hover:text-red-600 text-sm px-1">✕</button>
        </div>`).join('')
    : (rows.filter((p) => p.nome && p.nome.trim()).map((p, i) => `<div class="text-sm text-slate-700">${i + 1}. ${p.nome}${p.documento ? ' - ' + p.documento : ''}</div>`).join('')
        || '<p class="text-xs text-slate-400">Nenhum passageiro preenchido.</p>');

  const atingiuCapacidade = capacidade > 0 && rows.length >= capacidade;
  const addBtn = editable
    ? (atingiuCapacidade
        ? `<p class="text-xs text-amber-600 mt-1">⚠️ Capacidade máxima atingida (${capacidade} lugares).</p>`
        : `<button onclick="addListagemRow('${did}')" class="mt-1 px-3 py-1 border rounded-lg text-xs">+ Adicionar linha</button>`)
    : '';

  return `
    <div class="border rounded-xl p-3">
      <div class="flex items-center justify-between mb-2">
        <div class="font-medium text-sm">${v ? `${v.plate} - ${v.capacity} lugares` : 'Veículo não vinculado'}${d ? ` <span class="text-slate-500 font-normal">(Motorista: ${d.name})</span>` : ''}</div>
        <div class="text-xs ${corContagem}">${preenchidos}/${capacidade || '?'} preenchidos</div>
      </div>
      <div class="space-y-2">${linhas}</div>
      ${addBtn}
    </div>`;
}

function addListagemRow(driverId) {
  const v = driverVehicle(driverId);
  const rows = listagemRowsByDriver[driverId] || (listagemRowsByDriver[driverId] = []);
  if (v && v.capacity && rows.length >= v.capacity) { toast(`⚠️ Capacidade máxima do veículo (${v.capacity} lugares) atingida.`, true); return; }
  rows.push({ nome: '', tipo_documento: 'cpf', documento: '' });
  renderListagemVeiculoModal();
}
function removeListagemRow(driverId, idx) {
  const rows = listagemRowsByDriver[driverId];
  if (rows) rows.splice(idx, 1);
  renderListagemVeiculoModal();
}
function updateListagemField(driverId, idx, field, value) {
  // Não re-renderiza tudo aqui (perderia o foco do campo enquanto a pessoa digita) -
  // só atualiza o estado em memória; a lista completa é montada de novo só ao salvar.
  const rows = listagemRowsByDriver[driverId];
  if (rows && rows[idx]) rows[idx][field] = value;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Gera um PDF simples com a listagem de um veículo - usado só como anexo pro Google
// Drive (não é a ATF em si, quem emite a ATF é a cooperativa).
function gerarListagemPdf(trip, driverId) {
  if (!window.jspdf) return null;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const v = driverVehicle(driverId);
  const d = drivers.find((x) => x.id === driverId);
  const rows = (listagemRowsByDriver[driverId] || []).filter((p) => p.nome && p.nome.trim());
  doc.setFontSize(13);
  doc.text('Listagem de passageiros', 14, 15);
  doc.setFontSize(10);
  doc.text(`${trip.destination} - ${new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR')}`, 14, 22);
  doc.text(`Veículo: ${v ? v.plate + ' (' + v.capacity + ' lugares)' : '-'}  |  Motorista: ${d ? d.name : '-'}`, 14, 28);
  if (typeof doc.autoTable === 'function') {
    doc.autoTable({ startY: 34, head: [['#', 'Nome', 'Tipo', 'Documento']], body: rows.map((r, i) => [i + 1, r.nome, ({cpf:'CPF',rg:'RG',certidao_nascimento:'Certidão'}[r.tipo_documento] || r.tipo_documento || '-'), r.documento || '-']) });
  }
  return doc.output('blob');
}

async function registrarListagemFile(excursionId, driverId, filename, driveFileId, driveUrl) {
  if (sb) {
    await sb.from('excursion_listagem_files').insert([{ excursion_id: excursionId, driver_id: driverId, filename, drive_file_id: driveFileId || null, drive_url: driveUrl || null, created_by: currentUser.id }]);
  } else {
    const trip = agenda.find((a) => a.id === excursionId);
    if (trip) {
      trip.listagem_files = trip.listagem_files || [];
      trip.listagem_files.push({ driver_id: driverId, filename, drive_file_id: driveFileId || null, drive_url: driveUrl || null, created_at: new Date().toISOString() });
      saveDemoData();
    }
  }
}
async function listagemFilesForTrip(id) {
  if (sb) {
    const { data } = await sb.from('excursion_listagem_files').select('*').eq('excursion_id', id).order('created_at');
    return data || [];
  }
  const trip = agenda.find((a) => a.id === id);
  return (trip && trip.listagem_files) || [];
}

function cidadeEhForaDeNovaLima(cidade) {
  const c = String(cidade || '').trim().toLowerCase();
  return !!c && c !== 'nova lima';
}
function viagemForaDeNovaLima(trip) {
  return cidadeEhForaDeNovaLima(trip?.city);
}
function origemExternaForaDeNovaLima(trip) {
  return cidadeEhForaDeNovaLima(originCity(trip));
}
function precisaListagemComNomesDocumentos(trip) {
  return viagemForaDeNovaLima(trip) || origemExternaForaDeNovaLima(trip);
}

async function confirmEnviarListagem() {
  const id = listagemVeiculoTargetId;
  const trip = agenda.find((a) => a.id === id);
  if (!id || !trip) return;
  const driverIds = trip.driver_ids || [];
  if (!driverIds.length) { toast('⚠️ Esta viagem ainda não tem motorista/veículo atribuído.', true); return; }

  const foraDeNovaLima = precisaListagemComNomesDocumentos(trip);

  // Cada veículo precisa de pelo menos 1 passageiro preenchido - não precisa usar a
  // capacidade toda, mas uma listagem vazia não faz sentido enviar.
  for (const did of driverIds) {
    const rows = (listagemRowsByDriver[did] || []).filter((p) => p.nome && p.nome.trim());
    if (!rows.length) {
      const v = driverVehicle(did);
      toast(`⚠️ Preencha ao menos um passageiro na listagem do veículo ${v ? v.plate : driverName(did)}.`, true);
      return;
    }
  }

  // REGRA EXTERNA/ATF: destino fora de Nova Lima OU origem em outro município exige a relação completa de
  // passageiros com NOME + DOCUMENTO (CI/CNH/CPF). Não permitir envio com
  // documento faltando nem com quantidade de passageiros inferior ao solicitado.
  if (foraDeNovaLima) {
    for (const did of driverIds) {
      const rows = listagemRowsByDriver[did] || [];
      for (const p of rows) {
        const nome = String(p.nome || '').trim();
        const documento = String(p.documento || '').trim();
        const tipo = String(p.tipo_documento || '').trim();
        if ((nome && (!documento || !tipo)) || (!nome && (documento || tipo))) {
          const v = driverVehicle(did);
          toast(`⚠️ Para viagens fora de Nova Lima, todos os passageiros precisam ter nome e documento. Confira o veículo ${v ? v.plate : driverName(did)}.`, true);
          return;
        }
      }
    }
  }

  const allRows = [];
  driverIds.forEach((did) => {
    (listagemRowsByDriver[did] || []).filter((p) => p.nome && p.nome.trim())
      .forEach((p) => allRows.push({ nome: p.nome.trim(), tipo_documento: p.tipo_documento || 'cpf', documento: (p.documento || '').trim(), driver_id: did }));
  });

  if (foraDeNovaLima && allRows.some((p) => !p.nome || !p.documento || !p.tipo_documento)) {
    toast('⚠️ Para esta viagem, informe nome completo, tipo e número do documento de todos os passageiros preenchidos.', true);
    return;
  }

  const savedOk = await savePassengersForExcursion(id, allRows);
  if (!savedOk) return;

  const driveUrl = getDriveUploadUrl();
  if (!driveUrl) {
    toast('⚠️ Google Drive ainda não configurado (peça pro Admin configurar em Cooperativas) - listagem registrada só no sistema.', true);
  } else if (!window.jspdf) {
    toast('⚠️ Não foi possível gerar o PDF da listagem (verifique sua internet) - listagem registrada só no sistema.', true);
  } else {
    for (const did of driverIds) {
      try {
        const blob = gerarListagemPdf(trip, did);
        if (!blob) continue;
        const base64 = await blobToBase64(blob);
        const v = driverVehicle(did);
        const unidadeSlug = slugify(schoolName(trip.school_id) || trip.requester_name);
        const filename = `${trip.trip_date}_${unidadeSlug}_${v ? v.plate : did}.pdf`;
        const resp = await fetch(driveUrl, { method: 'POST', body: JSON.stringify({ filename, mimeType: 'application/pdf', fileBase64: base64 }) });
        const respJson = await resp.json();
        if (respJson.ok) await registrarListagemFile(id, did, filename, respJson.fileId, respJson.url);
      } catch (err) {
        toast('⚠️ Listagem salva, mas houve erro ao enviar um dos PDFs pro Drive: ' + (err && err.message ? err.message : err), true);
      }
    }
  }

  const wasReenvio = trip.listagem_status === 'rejeitada';
  const patchOk = await updateExcursion(id, {
    listagem_status: 'enviada',
    listagem_enviada_em: new Date().toISOString(),
    atf_lista_enviada_em: foraDeNovaLima ? new Date().toISOString() : trip.atf_lista_enviada_em || null,
    listagem_parecer_comentario: null,
  });
  if (!patchOk) return;
  await logDocHistory(id, wasReenvio ? 'reenviado' : 'enviado', null, null, null, 'listagem');
  await notifyAdmins('Listagem de passageiros para conferência', `${originName(trip) || requesterName(trip)} enviou a listagem da viagem para ${trip.destination || '-'} em ${trip.trip_date ? new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR') : '-'}.`);
  await loadAgenda(); await loadNotifications();
  renderAgenda();
  toast('✅ Listagem enviada! O Admin foi notificado para conferir.');
  closeListagemVeiculoModal();
}

async function confirmAceitarListagem() {
  const id = listagemVeiculoTargetId;
  const trip = agenda.find((a) => a.id === id);
  if (!id || !trip) return;
  const ok = await updateExcursion(id, {
    listagem_status: 'aceita',
    listagem_parecer_por: currentUser.id,
    listagem_parecer_em: new Date().toISOString(),
    listagem_parecer_comentario: null,
    atf_lista_conferida_em: precisaListagemComNomesDocumentos(trip) ? new Date().toISOString() : trip.atf_lista_conferida_em || null,
    atf_lista_conferida_por: precisaListagemComNomesDocumentos(trip) ? currentUser.id : trip.atf_lista_conferida_por || null,
  });
  if (!ok) return;
  await logDocHistory(id, 'aceito', null, null, null, 'listagem');
  await notifyRequester(trip, 'Listagem aprovada', 'A listagem de passageiros foi aprovada e será encaminhada à cooperativa do veículo.');
  await loadAgenda(); await loadNotifications();
  renderAgenda();
  toast('✅ Listagem aceita! Preparando envio para a(s) cooperativa(s)...');
  closeListagemVeiculoModal();
  await enviarListagemParaCooperativas(id);
}

async function conferirListaPcd(id) {
  if (currentUser?.role !== 'admin') return;
  const trip = agenda.find((a) => a.id === id); if (!trip) return;
  const rows = await getExcursionPcdStudents(id);
  const incompleto = rows.some((p) => !String(p.nome_aluno || '').trim() || !String(p.documento_aluno || '').trim() || (String(p.nome_apoio || '').trim() && !String(p.documento_apoio || '').trim()));
  if (!rows.length || incompleto) { toast('⚠️ A lista PCD precisa ter aluno, documento e, quando houver apoio, documento do apoio.', true); return; }
  if (!window.confirm(`Confirmar a conferência da lista PCD desta ocorrência (${rows.length} aluno(s))?`)) return;
  const now = new Date().toISOString();
  const ok = await updateExcursion(id, { pcd_lista_enviada_em: trip.pcd_lista_enviada_em || now, pcd_lista_conferida_em: now, pcd_lista_conferida_por: currentUser.id });
  if (!ok) return;
  await notifyRequester(trip, 'Lista PCD aprovada', 'A lista de aluno(s) PCD e apoio foi conferida e aprovada.');
  await loadAgenda(); await loadNotifications(); renderAgenda(); toast('✅ Lista PCD conferida.');
}

async function confirmRejeitarListagem() {
  const id = listagemVeiculoTargetId;
  const trip = agenda.find((a) => a.id === id);
  if (!id || !trip) return;
  const comentario = (document.getElementById('listagemParecerComentario').value || '').trim();
  if (!comentario) { toast('⚠️ Informe o motivo da rejeição, pra escola saber o que corrigir.', true); return; }
  const ok = await updateExcursion(id, {
    listagem_status: 'rejeitada',
    listagem_parecer_por: currentUser.id,
    listagem_parecer_em: new Date().toISOString(),
    listagem_parecer_comentario: comentario,
  });
  if (!ok) return;
  await logDocHistory(id, 'rejeitado', null, null, comentario, 'listagem');
  await notifyRequester({ ...trip, listagem_parecer_comentario: comentario }, 'Listagem devolvida para correção', `A listagem da viagem para ${trip.destination || '-'} foi devolvida para correção. Motivo: ${comentario}`);
  if (trip.requester_email) await notifyRequesterEmail({ ...trip, listagem_parecer_comentario: comentario }, 'Bora Lá - correção da listagem de passageiros', buildRequesterRejectedEmail({ ...trip, listagem_parecer_comentario: comentario }));
  await loadAgenda(); await loadNotifications();
  renderAgenda();
  toast('🚫 Listagem rejeitada - o solicitante foi notificado para corrigir e reenviar.');
  closeListagemVeiculoModal();
}

// Tenta mandar o e-mail de verdade via Edge Function (Resend) - se não estiver
// configurada ou der erro, devolve false e quem chamou cai pro rascunho manual de sempre.
async function tentarEnviarEmailAutomatico(to, subject, text) {
  if (!sb) return false; // modo demonstração não tem como chamar uma Edge Function de verdade
  try {
    const { data: { session } } = await sb.auth.getSession();
    const url = localStorage.getItem('sb_url') || DEFAULT_SUPABASE_URL;
    const anonKey = localStorage.getItem('sb_key') || DEFAULT_SUPABASE_ANON_KEY;
    const resp = await fetch(`${url}/functions/v1/send-cooperativa-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session ? session.access_token : anonKey}`, apikey: anonKey },
      body: JSON.stringify({ to, subject, text }),
    });
    const json = await resp.json().catch(() => ({}));
    return resp.ok && !json.error;
  } catch (err) {
    return false;
  }
}

// Monta o corpo do e-mail pra cooperativa a partir da listagem por veículo já aceita -
// mesmo modelo do e-mail de ATF de sempre, só que com uma seção por veículo.
function buildListagemEmailBody(trip, driverIdsForCoop, grouped, files) {
  const destinoCompleto = trip.destination_address
    ? `${trip.destination}, ${trip.destination_address}${trip.city ? ', ' + trip.city : ''}`
    : `${trip.destination}${trip.city ? ', ' + trip.city : ''}`;
  const dataFmt = trip.trip_date ? new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR') : '-';
  const assinatura = appSettings.remetente_nome || (currentUser && (currentUser.user_metadata?.full_name || currentUser.email)) || '';
  const blocos = driverIdsForCoop.map((did) => {
    const v = driverVehicle(did);
    const d = drivers.find((x) => x.id === did);
    const rows = grouped[did] || [];
    const listagemTxt = rows.length
      ? rows.map((p, i) => `  ${i + 1}. ${p.nome}${p.tipo_documento ? ' - ' + ({cpf:'CPF',rg:'RG',certidao_nascimento:'Certidão'}[p.tipo_documento] || p.tipo_documento) : ''}${p.documento ? ': ' + p.documento : ''}`).join('\n')
      : '  (listagem não encontrada)';
    const arquivo = files.find((f) => f.driver_id === did);
    const linkTxt = arquivo && arquivo.drive_url ? `\n  Arquivo no Drive: ${arquivo.drive_url}` : '';
    return `Veículo: ${v ? v.plate + ' (' + v.capacity + ' lugares)' : '-'} - Motorista: ${d ? d.name : '-'}\n${listagemTxt}${linkTxt}`;
  }).join('\n\n');

  return `Bom dia,

Solicita-se a emissão de ATF para a excursão abaixo:

Unidade: ${requesterName(trip)}
Endereço: ${requesterAddress(trip)}
Destino: ${destinoCompleto}
Data: ${dataFmt}
Saída: ${hhmm(trip.departure_time)} - Retorno: ${hhmm(trip.return_time)}

${blocos}

Gentileza acusar o recebimento.

${assinatura}`;
}

// Depois que o gestor aceita a listagem: tenta mandar automaticamente (Resend) pra cada
// cooperativa envolvida (pode ter mais de uma, se os veículos forem de cooperativas
// diferentes); quando não dá pra automatizar, cai pro mesmo modal manual de sempre,
// já pré-preenchido, pra conferir e clicar em enviar.
async function enviarListagemParaCooperativas(id) {
  const trip = agenda.find((a) => a.id === id);
  if (!trip) return;
  const driverIds = trip.driver_ids || [];
  if (!driverIds.length) return;

  const gruposPorCoop = {};
  driverIds.forEach((did) => {
    const d = drivers.find((x) => x.id === did);
    const coopId = (d && d.cooperativa_id) || '';
    (gruposPorCoop[coopId] = gruposPorCoop[coopId] || []).push(did);
  });
  const grupoIds = Object.keys(gruposPorCoop);
  const grouped = await getExcursionPassengersGrouped(id);
  const files = await listagemFilesForTrip(id);

  let precisaManual = false;
  for (const coopId of grupoIds) {
    const coop = cooperativaById(coopId || null);
    const driversDoGrupo = gruposPorCoop[coopId];
    const subject = buildCooperativaEmailSubject(trip, false);
    const body = buildListagemEmailBody(trip, driversDoGrupo, grouped, files);
    const enviouAuto = coop && coop.email ? await tentarEnviarEmailAutomatico(coop.email, subject, body) : false;
    if (enviouAuto) {
      await updateExcursion(id, { cooperativa_email_sent_at: new Date().toISOString(), atf_cooperativa_enviado_em: new Date().toISOString(), atf_status: precisaListagemComNomesDocumentos(trip) ? 'aguardando' : trip.atf_status, cooperativa_email_last_error: null });
      toast(`✉️ E-mail enviado automaticamente para ${coop.name}.`);
    } else if (!precisaManual) {
      await updateExcursion(id, { cooperativa_email_last_error: `Falha ao enviar para ${coop ? coop.email : 'cooperativa sem e-mail'}` });
      precisaManual = true;
      openCooperativaEmailModalPreenchido(id, coopId, subject, body);
    } else {
      toast(`ℹ️ Também envie manualmente para ${coop ? coop.name : 'a cooperativa correspondente'} (botão ✉️ na Agenda).`);
    }
  }
  const algumaCoopTemEmail = grupoIds.some((c) => { const coop = cooperativaById(c || null); return coop && coop.email; });
  if (algumaCoopTemEmail) {
    await updateExcursion(id, { envio_coop_data: fmtDate(new Date()), atf_cooperativa_enviado_em: new Date().toISOString(), atf_status: precisaListagemComNomesDocumentos(trip) ? 'aguardando' : trip.atf_status, situacao: 'envio_coop' });
    await loadAgenda();
    renderAgenda();
  }
}

// ============ ENVIAR PARA A COOPERATIVA (ATF ou transporte PCD) ============
// Não geramos a ATF - quem emite é a cooperativa. Aqui só preparamos um e-mail com os
// dados da viagem + a listagem, prontinho pra abrir no e-mail de quem estiver logado
// (imita exatamente o que já é feito manualmente hoje pelo setor de excursão).
async function reenviarListagemParaCooperativas(id) {
  if (currentUser?.role !== 'admin') return;
  await enviarListagemParaCooperativas(id);
  await loadAgenda();
  renderAgenda();
}

async function openCooperativaEmailModal(id) {
  emailTargetId = id;
  const trip = agenda.find((a) => a.id === id);
  if (!trip) return;

  const driverIds = trip.driver_ids || [];
  const primeiroMotorista = driverIds.length ? drivers.find((d) => d.id === driverIds[0]) : null;
  const defaultCoopId = (primeiroMotorista && primeiroMotorista.cooperativa_id) || '';

  populateCooperativaSelect('emailCooperativaId', defaultCoopId);

  const precisaPcd = (trip.pca_count || 0) > 0;
  const precisaAtf = precisaListagemComNomesDocumentos(trip);
  const tipo = document.getElementById('emailTipo');
  const tipoWrap = document.getElementById('emailTipoWrap');
  tipo.innerHTML = `${precisaPcd ? '<option value="pcd">Transporte adaptado PCD</option>' : ''}${precisaAtf ? '<option value="atf">Solicitação de ATF</option>' : ''}`;
  tipoWrap.classList.toggle('hidden', !(precisaPcd && precisaAtf));
  tipo.value = precisaPcd ? 'pcd' : 'atf';
  await onEmailTipoChange();

  onEmailCooperativaChange();
  document.getElementById('cooperativaEmailModal').classList.remove('hidden');
}
function closeCooperativaEmailModal() { document.getElementById('cooperativaEmailModal').classList.add('hidden'); emailTargetId = null; }
// Abre o mesmo modal de sempre, mas já com assunto/corpo prontos (usado como fallback
// manual quando o e-mail automático da listagem por veículo não está configurado/falha).
function openCooperativaEmailModalPreenchido(id, coopId, subject, body) {
  emailTargetId = id;
  populateCooperativaSelect('emailCooperativaId', coopId || '');
  document.getElementById('emailAssunto').value = subject;
  document.getElementById('emailCorpo').value = body;
  document.getElementById('emailTipoWrap').classList.add('hidden');
  document.getElementById('emailTipo').innerHTML = '<option value="atf">Solicitação de ATF</option>';
  document.getElementById('emailTipo').value = 'atf';
  onEmailCooperativaChange();
  document.getElementById('cooperativaEmailModal').classList.remove('hidden');
}
function onEmailCooperativaChange() {
  const coop = cooperativaById(document.getElementById('emailCooperativaId').value);
  document.getElementById('emailCooperativaAviso').classList.toggle('hidden', !coop || !!coop.email);
}

async function onEmailTipoChange() {
  const trip = agenda.find((a) => a.id === emailTargetId);
  if (!trip) return;
  const tipo = document.getElementById('emailTipo').value || ((trip.pca_count || 0) > 0 ? 'pcd' : 'atf');
  const driverNames = (trip.driver_ids || []).map((did) => (drivers.find((d) => d.id === did) || {}).name).filter(Boolean);
  document.getElementById('emailAssunto').value = buildCooperativaEmailSubject(trip, tipo === 'pcd');
  document.getElementById('emailCorpo').value = tipo === 'pcd'
    ? buildPcdEmailBody(trip, await getExcursionPcdStudents(trip.id))
    : buildAtfEmailBody(trip, await getExcursionPassengers(trip.id), driverNames);
}

function buildCooperativaEmailSubject(trip, isPcd) {
  const dataFmt = trip.trip_date ? new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR') : '';
  return isPcd
    ? `Transporte PCD - ${schoolName(trip.school_id)}_${dataFmt}`
    : `Solicitação de ATF - ${trip.destination} - ${dataFmt}`;
}

// Modelo real usado pelo setor (transporte PCD/veículo adaptado - vale pra qualquer
// destino, mesmo dentro de Nova Lima, e não depende de motorista cadastrado no sistema).
function buildPcdEmailBody(trip, pcdStudents) {
  const destinoCompleto = trip.destination_address
    ? `${trip.destination}, ${trip.destination_address}${trip.city ? ', ' + trip.city : ''}`
    : `${trip.destination}${trip.city ? ', ' + trip.city : ''}`;
  const listagem = (pcdStudents && pcdStudents.length)
    ? pcdStudents.map((p) => {
        const aluno = `Estudante: ${p.nome_aluno}${p.documento_aluno ? ' - ' + p.documento_aluno : ''}`;
        const apoio = p.nome_apoio ? `\n   Apoio: ${p.nome_apoio}${p.documento_apoio ? ' - ' + p.documento_apoio : ''}` : '';
        return aluno + apoio;
      }).filter(Boolean).join('\n')
    : '(nenhum aluno cadastrado ainda - edite a solicitação antes de enviar)';
  const assinatura = appSettings.remetente_nome || (currentUser && (currentUser.user_metadata?.full_name || currentUser.email)) || '';
  return `Bom dia
Solicita-se transporte PCD:
Unidade: ${requesterName(trip)}
Endereço: ${requesterAddress(trip)}
Destino: ${destinoCompleto}
Saída ${hhmm(trip.departure_time)}h - Retorno ${hhmm(trip.return_time)}h
listagem:
${listagem}

Gentileza acusar o recebimento
${assinatura}`;
}

// Rascunho nosso (não recebemos um modelo real desse - só o de PCD) para o pedido de
// ATF de uma excursão comum pra fora de Nova Lima. Ajustável no próprio modal antes
// de enviar, ou me avise se tiver um modelo diferente pra eu adaptar.
function buildAtfEmailBody(trip, passengers, driverNames) {
  const destinoCompleto = trip.destination_address
    ? `${trip.destination}, ${trip.destination_address}${trip.city ? ', ' + trip.city : ''}`
    : `${trip.destination}${trip.city ? ', ' + trip.city : ''}`;
  const dataFmt = trip.trip_date ? new Date(trip.trip_date + 'T00:00').toLocaleDateString('pt-BR') : '-';
  const totalPax = (trip.students_count || 0) + (trip.companions_count || 0) + (trip.pca_count || 0) + (trip.apoio_count || 0);
  const listagem = passengers.length
    ? passengers.map((p, i) => `${i + 1}. ${p.nome}${p.documento ? ' - ' + p.documento : ''}`).join('\n')
    : '(listagem de passageiros ainda não cadastrada - use o botão "📋 Lista" antes de enviar)';
  const assinatura = appSettings.remetente_nome || (currentUser && (currentUser.user_metadata?.full_name || currentUser.email)) || '';
  return `Bom dia,

Solicita-se a emissão de ATF para a excursão abaixo:

Unidade: ${requesterName(trip)}
Endereço: ${requesterAddress(trip)}
Destino: ${destinoCompleto}
Data: ${dataFmt}
Saída: ${hhmm(trip.departure_time)} - Retorno: ${hhmm(trip.return_time)}
Motorista(s): ${driverNames.length ? driverNames.join(', ') : '(a definir)'}
Nº de passageiros: ${totalPax}

Listagem:
${listagem}

Gentileza acusar o recebimento.

${assinatura}`;
}

function copyEmailText() {
  const texto = document.getElementById('emailCorpo').value;
  navigator.clipboard.writeText(texto).then(
    () => toast('📋 Texto copiado! Cole no seu e-mail.'),
    () => toast('⚠️ Não foi possível copiar automaticamente - selecione e copie o texto manualmente.', true)
  );
}

async function sendCooperativaEmail() {
  const coop = cooperativaById(document.getElementById('emailCooperativaId').value);
  if (!coop) { toast('⚠️ Selecione a cooperativa.', true); return; }
  if (!coop.email) { toast('⚠️ Essa cooperativa não tem e-mail cadastrado (tela Cooperativas).', true); return; }

  const assunto = document.getElementById('emailAssunto').value;
  const corpo = document.getElementById('emailCorpo').value;
  const mailto = `mailto:${encodeURIComponent(coop.email)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
  window.open(mailto, '_blank');

  const trip = agenda.find((a) => a.id === emailTargetId);
  const isPcd = document.getElementById('emailTipo').value === 'pcd';
  const ok = await updateExcursion(emailTargetId, {
    envio_coop_data: fmtDate(new Date()),
    ...(isPcd ? { pcd_cooperativa_enviado_em: new Date().toISOString() } : { atf_cooperativa_enviado_em: new Date().toISOString(), atf_status: trip && precisaListagemComNomesDocumentos(trip) ? 'aguardando' : trip?.atf_status }),
    situacao: 'envio_coop'
  });
  if (ok) { await loadAgenda(); renderAgenda(); }
  closeCooperativaEmailModal();
  toast('✉️ E-mail preparado! Confira e clique em enviar no seu programa de e-mail.');
}

// Atribuição de motorista(s): cada motorista dirige sempre o próprio veículo, então
// não existe mais um dropdown separado de veículo - a capacidade já vem junto do nome.
function openAssignModal(id) {
  assignTargetId = id;
  const trip = agenda.find((a) => a.id === id);
  assignTargetTotalPax = trip ? totalPassengers(trip) : 0;
  const currentIds = (trip && trip.driver_ids) || [];
  const list = document.getElementById('assignMotoristasList');
  const ativos = drivers.filter((d) => d.active !== false);
  list.innerHTML = ativos.length
    ? ativos.map((d) => {
        const v = driverVehicle(d.id);
        const capTxt = v ? `${v.capacity} lugares${v.plate ? ' • ' + v.plate : ''}` : 'sem veículo vinculado';
        return `
          <label class="flex items-center gap-2 text-sm py-1">
            <input type="checkbox" value="${d.id}" ${currentIds.includes(d.id) ? 'checked' : ''} onchange="updateAssignCapacidade()" class="assign-driver-check" />
            <span>${d.name}${d.cooperative ? ' - ' + d.cooperative : ''} <span class="text-xs text-slate-500">(${capTxt})</span></span>
          </label>`;
      }).join('')
    : '<p class="text-sm text-slate-500">Nenhum motorista ativo cadastrado.</p>';
  updateAssignCapacidade();
  document.getElementById('assignModal').classList.remove('hidden');
}

function updateAssignCapacidade() {
  const ids = Array.from(document.querySelectorAll('.assign-driver-check:checked')).map((el) => el.value);
  const el = document.getElementById('assignCapacidadeTotal');
  const cap = totalCapacity(ids);
  if (!ids.length) { el.innerHTML = ''; return; }
  const trip = agenda.find((a) => a.id === assignTargetId);
  const unicaViaturaInterna = viagemInteiraEmNovaLima(trip) && ids.length === 1;
  const insuficiente = cap < assignTargetTotalPax;
  const viagens = unicaViaturaInterna ? numeroViagensIndicadas(trip, ids) : 1;
  el.innerHTML = `<span class="${insuficiente && !unicaViaturaInterna ? 'text-red-600 font-medium' : 'text-slate-600'}">`
    + `Capacidade total selecionada: ${cap} lugares (viagem tem ${assignTargetTotalPax} passageiro${assignTargetTotalPax === 1 ? '' : 's'})`
    + `${unicaViaturaInterna ? ` • <strong>Número de viagens: ${String(viagens).padStart(2, '0')}</strong>${viagens > 1 ? ' (idas e voltas pelo mesmo veículo)' : ''}` : ''}`
    + `${insuficiente && !unicaViaturaInterna ? ' - ⚠️ Lugares insuficientes!' : ''}</span>`;
}

function closeAssignModal() { document.getElementById('assignModal').classList.add('hidden'); assignTargetId = null; }

async function confirmAssign() {
  const ids = Array.from(document.querySelectorAll('.assign-driver-check:checked')).map((el) => el.value);
  if (ids.length === 0) { toast('⚠️ Selecione ao menos um motorista.', true); return; }
  const cap = totalCapacity(ids);
  const tripParaEscala = agenda.find((a) => a.id === assignTargetId);
  const unicaViaturaInterna = viagemInteiraEmNovaLima(tripParaEscala) && ids.length === 1;
  if (cap < assignTargetTotalPax && !unicaViaturaInterna) {
    toast(`⚠️ Lugares insuficientes: ${assignTargetTotalPax} passageiros e só ${cap} lugares nos veículos selecionados. Adicione outro motorista/veículo.`, true);
    return;
  }

  if (sb) {
    const { error: delErr } = await sb.from('excursion_drivers').delete().eq('excursion_id', assignTargetId);
    if (delErr) { toast('❌ Erro ao atualizar motoristas: ' + delErr.message, true); return; }
    const { error: insErr } = await sb.from('excursion_drivers').insert(ids.map((driver_id) => ({ excursion_id: assignTargetId, driver_id })));
    if (insErr) { toast('❌ Erro ao atribuir motoristas: ' + insErr.message, true); return; }
  }

  const patch = {
    status: 'approved',
    assigned_driver_id: ids[0] || null, // mantido só por compatibilidade
    approved_by: currentUser.id,
    approved_at: new Date().toISOString(),
  };
  if (!sb) patch.driver_ids = ids;

  const ok = await updateExcursion(assignTargetId, patch);
  if (ok) {
    const tripAtual = agenda.find(a => a.id === assignTargetId);
    const precisaLista = tripAtual && precisaListagemComNomesDocumentos(tripAtual);
    if (precisaLista) {
      const extra = {};
      const solicitanteExterno = tripAtual.solicitation_type === 'agendamento' || !tripAtual.school_id;
      if (solicitanteExterno) {
        extra.passenger_access_token = tripAtual.passenger_access_token || gerarTokenAcessoPassageiros();
        extra.passenger_access_status = 'aberto';
        extra.passenger_access_submitted_at = null;
      } else {
        extra.listagem_status = 'nao_enviada';
        const perfilEscola = allProfiles.find(p => p.role === 'escola' && p.school_id === tripAtual.school_id && p.active !== false);
        if (perfilEscola?.email) extra.requester_email = perfilEscola.email;
      }
      await updateExcursion(assignTargetId, extra);
      const atualizado = { ...tripAtual, ...extra };
      await notifyRequester(atualizado, 'Lista de passageiros liberada', 'A viagem foi aprovada e o motorista foi atribuído. Preencha a listagem de passageiros.');
      if (atualizado.requester_email) {
        const base = location.href.split('#')[0].replace(/[^/]*$/, '');
        const link = (atualizado.solicitation_type === 'agendamento' || !atualizado.school_id) && atualizado.passenger_access_token
          ? `${base}passageiros.html?token=${encodeURIComponent(atualizado.passenger_access_token)}`
          : '';
        const sent = await notifyRequesterEmail(atualizado, 'Bora Lá - preencher listagem de passageiros', buildRequesterPassengerEmail(atualizado, link));
        if (sent) await updateExcursion(assignTargetId, { passenger_access_notified_at: new Date().toISOString() });
      }
    }
    await loadAgenda(); await loadNotifications(); renderAgenda(); renderDashboard();
    const voltas = numeroViagensIndicadas(tripAtual, ids);
    toast('✅ Viagem aprovada e motorista(s) atribuído(s)!' + (voltas > 1 ? ` Número de viagens do veículo: ${String(voltas).padStart(2, '0')}.` : '') + (precisaLista ? ' A listagem de passageiros foi liberada.' : ''));
  }
  closeAssignModal();
}

async function startTransit(id) {
  const ok = await updateExcursion(id, { status: 'in_transit' });
  if (ok) { await loadAgenda(); renderAgenda(); renderDashboard(); toast('🚌 Viagem iniciada!'); }
}
async function completeTrip(id) {
  const ok = await updateExcursion(id, { status: 'completed' });
  if (ok) { await loadAgenda(); renderAgenda(); renderDashboard(); toast('🏁 Viagem concluída!'); }
}

// ============ WIZARD (NOVA SOLICITAÇÃO) ============
function openSolicitacaoScreen() {
  populateEscolaSelect();
  populateAgendamentoDestinoSelect();
  resetWizard();
  // Renderiza imediatamente com a escola do perfil logado. A configuração dinâmica
  // chega depois, sem trocar a tela temporariamente pelo estado do administrador.
  loadValidationConfig().then(() => populatePublicoAlvoWizard()).catch(() => {});
}

function populatePublicoAlvoWizard() {
  const select = document.getElementById('wPublicoAlvo');
  if (!select || !validationTargets.length) return;
  select.innerHTML = '<option value="">— selecione —</option>' + validationTargets.filter((t) => t.active !== false).map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}
function publicoAlvoLabel(value) {
  return validationTargets.find((t) => t.id === value)?.name || PUBLICO_ALVO_LABELS[value] || '-';
}

function populateEscolaSelect() {
  const sel = document.getElementById('wEscola');
  if (!sel) return;

  const visiveis = schools.filter((s) => s.active !== false || s.id === currentUser.schoolId);
  sel.innerHTML = visiveis.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')
    + '<option value="__outra__">Outra (não cadastrada)</option>';
  if (currentUser.role === 'escola' && currentUser.schoolId) {
    sel.value = currentUser.schoolId;
    sel.disabled = true;
  } else {
    sel.disabled = false;
  }
  onWEscolaChange();
}

function getTipoSolicitacaoWizard() {
  return document.querySelector('input[name="wTipoSolicitacao"]:checked')?.value || 'excursao';
}

function onWTipoSolicitacaoChange() {
  const tipo = getTipoSolicitacaoWizard();
  const isAgendamento = tipo === 'agendamento';

  const origemBox = document.getElementById('wAgendamentoOrigemBox');
  const destinoNormalBox = document.getElementById('wDestinoNormalBox');
  const destinoAgendamentoBox = document.getElementById('wDestinoAgendamentoBox');
  const destinoTitulo = document.getElementById('wDestinoTitulo');

  if (origemBox) origemBox.classList.toggle('hidden', !isAgendamento);
  if (destinoNormalBox) destinoNormalBox.classList.toggle('hidden', isAgendamento);
  if (destinoAgendamentoBox) destinoAgendamentoBox.classList.toggle('hidden', !isAgendamento);
  if (destinoTitulo) destinoTitulo.textContent = isAgendamento ? 'Destino do agendamento' : 'Destino da excursão';

  if (isAgendamento) {
    populateAgendamentoDestinoSelect();
    const escolaId = document.getElementById('wEscola')?.value;
    if (escolaId && escolaId !== '__outra__') {
      const destino = document.getElementById('wDestinoEscola');
      if (destino) {
        destino.value = escolaId;
        onWDestinoEscolaChange();
      }
    }
  }
}

function populateAgendamentoDestinoSelect() {
  const sel = document.getElementById('wDestinoEscola');
  if (!sel) return;

  const visiveis = schools.filter((s) => s.active !== false);
  sel.innerHTML = '<option value="">— selecione a escola de destino —</option>' +
    visiveis.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');

  const escolaSelecionada = document.getElementById('wEscola')?.value;
  if (escolaSelecionada && escolaSelecionada !== '__outra__' && visiveis.some((s) => s.id === escolaSelecionada)) {
    sel.value = escolaSelecionada;
  }
  onWDestinoEscolaChange();
}

function onWDestinoEscolaChange() {
  const select = document.getElementById('wDestinoEscola');
  const endereco = document.getElementById('wDestinoEscolaEndereco');
  if (!select || !endereco) return;

  const escola = schools.find((s) => s.id === select.value);
  endereco.value = escola?.address || '';

  const cidade = document.getElementById('wCidadeAgendamento');
  if (cidade) cidade.value = escola?.city || '';
}

function onWEscolaChange() {
  const escolaEl = document.getElementById('wEscola');
  if (!escolaEl) return;

  const isOutra = escolaEl.value === '__outra__';
  const outraBox = document.getElementById('wOutraBox');
  if (outraBox) outraBox.classList.toggle('hidden', !isOutra);

  if (getTipoSolicitacaoWizard() === 'agendamento' && !isOutra) {
    const destino = document.getElementById('wDestinoEscola');
    if (destino) {
      destino.value = escolaEl.value;
      onWDestinoEscolaChange();
    }
  }
}

function onWRecorrenciaChange() {
  const recorrencia = document.querySelector('input[name="wRecorrencia"]:checked').value;
  document.getElementById('wRecorrenciaDetalhes').classList.toggle('hidden', recorrencia === 'unico');
}

function addRecurrenceDateField(value = '') {
  const container = document.getElementById('wDatasRecorrencia');
  if (!container) return;
  const inputs = container.querySelectorAll('input[type="date"]');
  if (inputs.length >= 3) { toast('⚠️ Você pode selecionar até 3 datas adicionais.', true); return; }
  const indice = inputs.length + 1;
  const field = document.createElement('div');
  field.className = 'relative';
  field.innerHTML = `<label class="block text-xs font-medium text-emerald-900 mb-1">Data adicional ${indice}</label><input type="date" value="${value}" class="w-full px-3 py-2 border border-emerald-200 rounded-lg bg-white text-sm" data-recurrence-extra-date /><button type="button" onclick="this.parentElement.remove(); renumberRecurrenceDateFields()" class="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-slate-200 text-xs text-slate-600" title="Remover data">×</button>`;
  container.appendChild(field);
}

function renumberRecurrenceDateFields() {
  document.querySelectorAll('#wDatasRecorrencia > div').forEach((row, i) => {
    const label = row.querySelector('label');
    if (label) label.textContent = `Data adicional ${i + 1}`;
  });
}

function selectedRecurrenceDates() {
  return Array.from(document.querySelectorAll('[data-recurrence-extra-date]'))
    .map((input) => input.value)
    .filter(Boolean);
}

// Redesenha as linhas de "aluno PCD" conforme o número digitado em wPCA, preservando
// o que já tiver sido preenchido nas linhas existentes.
function renderPcdRows() {
  const n = parseInt(document.getElementById('wPCA').value) || 0;
  document.getElementById('wPcdBox').classList.toggle('hidden', n === 0);

  while (wizardPcdList.length < n) wizardPcdList.push({ nome_aluno: '', cadeirante: false, documento_aluno: '', nome_apoio: '', documento_apoio: '' });
  wizardPcdList.length = n;

  const rows = document.getElementById('wPcdRows');
  rows.innerHTML = wizardPcdList.map((p, i) => `
    <div class="grid grid-cols-3 gap-2 items-end border-b border-slate-200 pb-2">
      <div>
        <label class="block text-xs font-medium mb-1">Nome do aluno</label>
        <input type="text" value="${p.nome_aluno}" oninput="updatePcdField(${i}, 'nome_aluno', this.value)" class="w-full px-2 py-1.5 border rounded text-sm" />
      </div>
      <div>
        <label class="block text-xs font-medium mb-1">Documento do aluno</label>
        <input type="text" value="${p.documento_aluno || ''}" placeholder="CI/CNH/CPF" oninput="updatePcdField(${i}, 'documento_aluno', this.value)" class="w-full px-2 py-1.5 border rounded text-sm" />
      </div>
      <div>
        <label class="block text-xs font-medium mb-1">Cadeirante?</label>
        <select onchange="updatePcdField(${i}, 'cadeirante', this.value === 'sim')" class="w-full px-2 py-1.5 border rounded text-sm">
          <option value="nao" ${!p.cadeirante ? 'selected' : ''}>Não</option>
          <option value="sim" ${p.cadeirante ? 'selected' : ''}>Sim</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium mb-1">Nome do apoio</label>
        <input type="text" value="${p.nome_apoio}" oninput="updatePcdField(${i}, 'nome_apoio', this.value)" class="w-full px-2 py-1.5 border rounded text-sm" />
      </div>
      <div>
        <label class="block text-xs font-medium mb-1">Documento do apoio</label>
        <input type="text" value="${p.documento_apoio || ''}" placeholder="CI/CNH/CPF" oninput="updatePcdField(${i}, 'documento_apoio', this.value)" class="w-full px-2 py-1.5 border rounded text-sm" />
      </div>
      <div></div>
    </div>`).join('');
}

function updatePcdField(i, field, value) {
  if (wizardPcdList[i]) wizardPcdList[i][field] = value;
}

function resetWizard() {
  // Escola já tem a própria unidade fixada (não escolhe outra), então a "Passo 1" não
  // pergunta nada de novo pra ela - pula direto pro Passo 2 (Destino).
  wizardMinStep = (currentUser.role === 'escola' && currentUser.schoolId) ? 2 : 1;
  wizardStep = wizardMinStep;
  for (let i = 1; i <= 5; i++) {
    document.getElementById('step' + i).classList.add('hidden');
    document.getElementById('prog' + i).className = i <= wizardMinStep ? 'h-1.5 flex-1 bg-emerald-500 rounded' : 'h-1.5 flex-1 bg-slate-200 rounded';
  }
  document.getElementById('step' + wizardMinStep).classList.remove('hidden');
  document.getElementById('wizardStep').textContent = wizardMinStep;
  document.getElementById('btnPrev').classList.add('hidden');
  document.getElementById('btnNext').textContent = 'Próximo →';
  document.getElementById('wOutraNome').value = '';
  document.getElementById('wOutraEndereco').value = '';
  document.getElementById('wOutraTelefone').value = '';
  document.getElementById('wOutraEmail').value = '';
  document.getElementById('wOutraBox').classList.add('hidden');
  const tipoExcursao = document.querySelector('input[name="wTipoSolicitacao"][value="excursao"]');
  if (tipoExcursao) tipoExcursao.checked = true;
  const origemNome = document.getElementById('wOrigemNome');
  const origemEndereco = document.getElementById('wOrigemEndereco');
  const destinoEscola = document.getElementById('wDestinoEscola');
  const destinoEscolaEndereco = document.getElementById('wDestinoEscolaEndereco');
  const cidadeAgendamento = document.getElementById('wCidadeAgendamento');
  if (origemNome) origemNome.value = '';
  if (origemEndereco) origemEndereco.value = '';
  if (destinoEscola) destinoEscola.value = '';
  if (destinoEscolaEndereco) destinoEscolaEndereco.value = '';
  if (cidadeAgendamento) cidadeAgendamento.value = '';
  const origemCidade = document.getElementById('wOrigemCidade');
  if (origemCidade) origemCidade.value = '';
  const origemEmail = document.getElementById('wOrigemEmail');
  if (origemEmail) origemEmail.value = '';
  const outraCidade = document.getElementById('wOutraCidade');
  if (outraCidade) outraCidade.value = '';
  document.getElementById('wDestino').value = '';
  document.getElementById('wDestinoEndereco').value = '';
  document.getElementById('wCidade').value = '';
  document.getElementById('wData').value = '';
  document.getElementById('wHora').value = '';
  document.getElementById('wHoraRetorno').value = '';
  document.getElementById('wAlunos').value = '';
  document.getElementById('wAcompanhantes').value = '';
  document.getElementById('wPCA').value = 0;
  document.getElementById('wPublicoAlvo').value = '';
  wizardPcdList = [];
  document.getElementById('wPcdBox').classList.add('hidden');
  document.getElementById('wPcdRows').innerHTML = '';
  document.getElementById('wObservacoes').value = '';
  const unico = document.querySelector('input[name="wRecorrencia"][value="unico"]');
  if (unico) unico.checked = true;
  document.getElementById('wRecorrenciaDetalhes').classList.add('hidden');
  document.querySelectorAll('input[name="wDiaSemana"]').forEach((el) => { el.checked = false; });
  document.getElementById('wRecorrenciaFim').value = '';
  document.getElementById('wDatasRecorrencia').innerHTML = '';
  onWTipoSolicitacaoChange();
}

function validateWizardStep(step) {
  const tipo = getTipoSolicitacaoWizard();
  const isAgendamento = tipo === 'agendamento';

  if (step === 1) {
    const escolaId = document.getElementById('wEscola')?.value;

    if (isAgendamento && (!escolaId || escolaId === '__outra__')) {
      toast('⚠️ Selecione a escola que receberá a equipe/comitiva.', true);
      return false;
    }

    if (escolaId === '__outra__' && !document.getElementById('wOutraNome').value.trim()) {
      toast('⚠️ Informe o nome da unidade/solicitante.', true);
      return false;
    }
    if (escolaId === '__outra__' && !document.getElementById('wOutraEndereco').value.trim()) {
      toast('⚠️ Informe o endereço da unidade/solicitante.', true);
      return false;
    }
    if (escolaId === '__outra__' && !document.getElementById('wOutraCidade')?.value.trim()) {
      toast('⚠️ Informe a cidade da origem.', true);
      return false;
    }

    if (isAgendamento) {
      const origemNome = document.getElementById('wOrigemNome')?.value.trim();
      const origemEndereco = document.getElementById('wOrigemEndereco')?.value.trim();
      if (!origemNome) {
        toast('⚠️ Informe o nome da origem.', true);
        return false;
      }
      if (!origemEndereco) {
        toast('⚠️ Informe o endereço da origem.', true);
        return false;
      }
      if (!document.getElementById('wOrigemCidade')?.value.trim()) {
        toast('⚠️ Informe a cidade da origem.', true);
        return false;
      }
      if (!document.getElementById('wOrigemEmail')?.value.trim()) {
        toast('⚠️ Informe o e-mail da entidade/comitiva para envio do cadastro de passageiros.', true);
        return false;
      }
    }
  }

  if (step === 2) {
    if (isAgendamento) {
      const destinoEscola = document.getElementById('wDestinoEscola')?.value;
      const endereco = document.getElementById('wDestinoEscolaEndereco')?.value.trim();
      if (!destinoEscola) {
        toast('⚠️ Selecione a escola de destino.', true);
        return false;
      }
      if (!endereco) {
        toast('⚠️ A escola selecionada não possui endereço cadastrado.', true);
        return false;
      }
    } else if (!document.getElementById('wDestino').value.trim() || !document.getElementById('wDestinoEndereco').value.trim() || !document.getElementById('wCidade').value.trim()) {
      toast('⚠️ Informe destino, endereço e cidade.', true);
      return false;
    }
  }

  if (step === 3) {
    if (!document.getElementById('wData').value || !document.getElementById('wHora').value || !document.getElementById('wHoraRetorno').value) {
      toast('⚠️ Informe data, horário de saída e horário de retorno.', true);
      return false;
    }
  }

  if (step === 4) {
    if (document.getElementById('wAlunos').value === '' || document.getElementById('wAcompanhantes').value === '') {
      toast('⚠️ Informe a quantidade de alunos e de acompanhantes (use 0 quando não houver).', true);
      return false;
    }
    if (!document.getElementById('wPublicoAlvo').value) {
      toast('⚠️ Escolha o público-alvo desta excursão.', true);
      return false;
    }
    if (wizardPcdList.some((p) => !p.nome_aluno.trim() || !p.documento_aluno.trim() || (p.nome_apoio && !p.documento_apoio.trim()))) {
      toast('⚠️ Para cada PCD, informe nome e documento; se houver apoio, informe também seu documento.', true);
      return false;
    }
    const recorrencia = document.querySelector('input[name="wRecorrencia"]:checked').value;
    if (recorrencia !== 'unico') {
      const temDia = document.querySelectorAll('input[name="wDiaSemana"]:checked').length > 0;
      const fim = document.getElementById('wRecorrenciaFim').value;
      if (!temDia || !fim) {
        toast('⚠️ Escolha os dias da semana e a data final da recorrência.', true);
        return false;
      }
      const extras = selectedRecurrenceDates();
      if (new Set(extras).size !== extras.length) {
        toast('⚠️ Não repita uma data adicional na mesma recorrência.', true);
        return false;
      }
      if (extras.some((d) => d <= document.getElementById('wData').value)) {
        toast('⚠️ Cada data adicional deve ser posterior à data inicial da viagem.', true);
        return false;
      }
    }
  }
  return true;
}

function wizardNext() {
  if (!validateWizardStep(wizardStep)) return;

  if (wizardStep < 5) {
    document.getElementById('step' + wizardStep).classList.add('hidden');
    wizardStep++;
    document.getElementById('step' + wizardStep).classList.remove('hidden');
    document.getElementById('wizardStep').textContent = wizardStep;

    for (let i = 1; i <= 5; i++) {
      document.getElementById('prog' + i).className = i <= wizardStep
        ? 'h-1.5 flex-1 bg-emerald-500 rounded'
        : 'h-1.5 flex-1 bg-slate-200 rounded';
    }

    document.getElementById('btnPrev').classList.remove('hidden');
    if (wizardStep === 5) {
      document.getElementById('btnNext').textContent = '✓ Enviar Solicitação';
      renderResumo();
    }
  } else {
    submitSolicitacao();
  }
}

function wizardPrev() {
  if (wizardStep > wizardMinStep) {
    document.getElementById('step' + wizardStep).classList.add('hidden');
    wizardStep--;
    document.getElementById('step' + wizardStep).classList.remove('hidden');
    document.getElementById('wizardStep').textContent = wizardStep;

    for (let i = 1; i <= 5; i++) {
      document.getElementById('prog' + i).className = i <= wizardStep
        ? 'h-1.5 flex-1 bg-emerald-500 rounded'
        : 'h-1.5 flex-1 bg-slate-200 rounded';
    }

    document.getElementById('btnNext').textContent = 'Próximo →';
    if (wizardStep === wizardMinStep) document.getElementById('btnPrev').classList.add('hidden');
  }
}

function renderResumo() {
  const tipo = getTipoSolicitacaoWizard();
  const isAgendamento = tipo === 'agendamento';
  const escolaId = document.getElementById('wEscola').value;
  const isOutra = escolaId === '__outra__';
  const escola = isOutra ? (document.getElementById('wOutraNome').value || '-') : schoolName(escolaId);

  let origem;
  let origemEndereco;
  let destino;
  let destinoEndereco;
  let cidade;

  if (isAgendamento) {
    origem = document.getElementById('wOrigemNome')?.value || '-';
    origemEndereco = document.getElementById('wOrigemEndereco')?.value || '-';
    const destinoEscolaId = document.getElementById('wDestinoEscola')?.value;
    destino = schoolName(destinoEscolaId);
    destinoEndereco = document.getElementById('wDestinoEscolaEndereco')?.value || '-';
    cidade = document.getElementById('wCidadeAgendamento')?.value || '';
  } else {
    origem = escola;
    origemEndereco = isOutra ? (document.getElementById('wOutraEndereco').value || '-') : (schoolAddress(escolaId) || '-');
    destino = document.getElementById('wDestino').value;
    destinoEndereco = document.getElementById('wDestinoEndereco').value;
    cidade = document.getElementById('wCidade').value;
  }

  const data = document.getElementById('wData').value;
  const hora = document.getElementById('wHora').value;
  const horaRetorno = document.getElementById('wHoraRetorno').value;
  const alunos = parseInt(document.getElementById('wAlunos').value) || 0;
  const acompanhantes = parseInt(document.getElementById('wAcompanhantes').value) || 0;
  const pca = wizardPcdList.length;
  const apoios = wizardPcdList.filter((p) => p.nome_apoio && p.nome_apoio.trim()).length;
  const recorrencia = document.querySelector('input[name="wRecorrencia"]:checked').value;
  const turnoLabel = TURNO_LABELS[turnoFromHora(hora)] || '-';

  let recorrenciaTxt = 'Evento Único';
  if (recorrencia !== 'unico') {
    const dias = Array.from(document.querySelectorAll('input[name="wDiaSemana"]:checked'))
      .map((el) => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][parseInt(el.value)]).join(', ');
    const fim = document.getElementById('wRecorrenciaFim').value;
    recorrenciaTxt = `Continuado ${recorrencia} - ${dias || 'nenhum dia escolhido'}, até ${fim ? new Date(fim + 'T00:00').toLocaleDateString('pt-BR') : '-'}`;
    const extras = selectedRecurrenceDates();
    if (extras.length) recorrenciaTxt += ` · datas adicionais: ${extras.map((d) => new Date(d + 'T00:00').toLocaleDateString('pt-BR')).join(', ')}`;
  }

  document.getElementById('resumoSolicitacao').innerHTML = `
    <div><strong>Tipo de solicitação:</strong> ${isAgendamento ? 'Agendamento recebido' : 'Excursão da unidade'}</div>
    <div><strong>Unidade vinculada:</strong> ${escola || '-'}</div>
    <div class="pt-2"><strong>Origem:</strong> ${origem || '-'}</div>
    <div class="text-slate-500"><strong>Endereço da origem:</strong> ${origemEndereco || '-'}</div>
    <div class="pt-2"><strong>Destino:</strong> ${destino || '-'}</div>
    <div class="text-slate-500"><strong>Endereço do destino:</strong> ${destinoEndereco || '-'}</div>
    <div><strong>Cidade:</strong> ${cidade || '-'}</div>
    <div><strong>Turno (automático):</strong> ${turnoLabel}</div>
    <div><strong>Data/Hora:</strong> ${data ? new Date(data + 'T00:00').toLocaleDateString('pt-BR') : '-'} às ${hora || '-'}${horaRetorno ? ' (retorno previsto ' + horaRetorno + ')' : ''}</div>
    <div><strong>Passageiros:</strong> ${alunos} alunos + ${acompanhantes} acompanhantes${pca ? ` + ${pca} PCD + ${apoios} apoio(s)` : ''} = <strong>${alunos + acompanhantes + pca + apoios} pessoas</strong></div>
    <div><strong>Público-alvo:</strong> ${publicoAlvoLabel(document.getElementById('wPublicoAlvo').value)}</div>
    <div><strong>Tipo:</strong> ${recorrenciaTxt}</div>
  `;

  const total = alunos + acompanhantes;
  const micros = Math.floor(total / 32);
  const resto = total % 32;
  const vans = Math.ceil(resto / 15);
  let sug = `<strong>🚌 Sugestão Automática de Veículos:</strong><br/>`;
  if (total === 0) {
    sug += 'Informe a quantidade de alunos para calcular.';
  } else {
    sug += `Total: ${total} pessoas<br/>`;
    if (micros > 0) sug += `• ${micros} micro-ônibus (32 lugares)<br/>`;
    if (vans > 0) sug += `• ${vans} van (15 lugares)<br/>`;
    const foraMunicipio = cidadeEhForaDeNovaLima(cidade) || cidadeEhForaDeNovaLima(document.getElementById('wOrigemCidade')?.value || (isAgendamento ? '' : document.getElementById('wOutraCidade')?.value || ''));
    if (foraMunicipio) sug += `<br/>⚠️ Viagem FORA de Nova Lima - será necessária <strong>ATF</strong>`;
  }
  document.getElementById('sugestaoVeiculos').innerHTML = sug;
}

function newGroupId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

let additionalRecurrenceSourceId = null;

function openAddRecurrenceDateModal(id) {
  const trip = agenda.find((a) => a.id === id);
  if (!trip || currentUser?.role !== 'escola' || trip.school_id !== currentUser.schoolId || !trip.recurrence_group_id) return;
  additionalRecurrenceSourceId = id;
  const input = document.getElementById('addRecurrenceDateInput');
  if (input) { input.value = ''; input.min = fmtDate(new Date()); }
  document.getElementById('addRecurrenceDateModal').classList.remove('hidden');
}

function closeAddRecurrenceDateModal() {
  document.getElementById('addRecurrenceDateModal').classList.add('hidden');
  additionalRecurrenceSourceId = null;
}

async function saveAdditionalRecurrenceDate() {
  const source = agenda.find((a) => a.id === additionalRecurrenceSourceId);
  const date = document.getElementById('addRecurrenceDateInput')?.value;
  if (!source || !date) { toast('⚠️ Escolha a nova data.', true); return; }
  const sameDate = agenda.some((a) => a.recurrence_group_id === source.recurrence_group_id && a.trip_date === date);
  if (sameDate) { toast('⚠️ Esta data já existe nesta recorrência.', true); return; }

  // Uma nova ocorrência herda a avaliação pedagógica da série, quando houver, mas
  // nunca herda decisão/escala administrativa. Assim ela aguarda confirmação própria.
  const { id, created_at, updated_at, driver_ids, assigned_vehicle_id, assigned_driver_id, approved_by, approved_at,
    admin_processed_at, admin_processed_by, cancelled_by, cancelled_at, cancel_reason, rejection_reason, ...base } = source;
  const focoValidado = !!source.pedagogy_approved_at || source.status === 'pedagogy_approved' || source.status === 'approved';
  const nova = {
    ...base,
    trip_date: date,
    status: focoValidado ? 'pedagogy_approved' : 'pending',
    situacao: focoValidado ? (precisaListagemComNomesDocumentos(source) ? 'aguarda_atf' : 'aprovada') : 'sem_validacao',
    recurrence_group_id: source.recurrence_group_id,
    selected_recurrence_dates: [date],
    created_by: currentUser.id,
  };

  let inserted;
  if (sb) {
    const { data, error } = await sb.from('excursions').insert([nova]).select().single();
    if (error) { toast('❌ Não foi possível adicionar a data: ' + error.message, true); return; }
    inserted = data;
    const { data: pcdRows } = await sb.from('excursion_pcd_students').select('nome_aluno,cadeirante,documento_aluno,nome_apoio,documento_apoio').eq('excursion_id', source.id);
    if (pcdRows?.length) {
      const { error: pcdError } = await sb.from('excursion_pcd_students').insert(pcdRows.map((row) => ({ ...row, excursion_id: inserted.id })));
      if (pcdError) toast('⚠️ A data foi criada, mas confira o cadastro PCD: ' + pcdError.message, true);
    }
  } else {
    inserted = { ...nova, id: 'e' + Date.now(), created_at: new Date().toISOString(), driver_ids: [] };
    agenda.push(inserted); saveDemoData();
  }
  closeAddRecurrenceDateModal();
  await loadAgenda(); renderAgenda();
  toast(`✅ Nova ocorrência criada para ${new Date(date + 'T00:00').toLocaleDateString('pt-BR')}. Aguarda confirmação do Admin.`);
}

async function submitSolicitacao() {
  const tipo = getTipoSolicitacaoWizard();
  const isAgendamento = tipo === 'agendamento';
  const escolaId = document.getElementById('wEscola').value;
  const isOutra = escolaId === '__outra__';
  const hora = document.getElementById('wHora').value;
  const dataInicial = document.getElementById('wData').value;
  const recorrencia = document.querySelector('input[name="wRecorrencia"]:checked').value;
  const datasAdicionais = selectedRecurrenceDates();
  const anexarProposta = !!document.getElementById('wAnexarProposta')?.checked;
  let primeiraViagemCriadaId = null;

  let originNameValue;
  let originAddressValue;
  let destinationValue;
  let destinationAddressValue;
  let cityValue;

  if (isAgendamento) {
    originNameValue = document.getElementById('wOrigemNome').value.trim();
    originAddressValue = document.getElementById('wOrigemEndereco').value.trim();
    const destinoEscolaId = document.getElementById('wDestinoEscola').value;
    destinationValue = schoolName(destinoEscolaId);
    destinationAddressValue = document.getElementById('wDestinoEscolaEndereco').value.trim() || null;
    cityValue = document.getElementById('wCidadeAgendamento').value.trim();
    var originCityValue = document.getElementById('wOrigemCidade')?.value.trim() || null;
    var originEmailValue = document.getElementById('wOrigemEmail')?.value.trim() || null;
  } else {
    originNameValue = isOutra ? (document.getElementById('wOutraNome').value.trim() || null) : (schoolName(escolaId) || null);
    originAddressValue = isOutra ? (document.getElementById('wOutraEndereco').value.trim() || null) : (schoolAddress(escolaId) || null);
    destinationValue = document.getElementById('wDestino').value.trim();
    destinationAddressValue = document.getElementById('wDestinoEndereco').value.trim() || null;
    cityValue = document.getElementById('wCidade').value.trim();
    var originCityValue = isOutra ? (document.getElementById('wOutraCidade')?.value.trim() || null) : (schools.find((x) => x.id === escolaId)?.city || null);
    var originEmailValue = isOutra ? (document.getElementById('wOutraEmail')?.value.trim() || null) : null;
  }

  const base = {
    school_id: isOutra ? null : (escolaId || null),
    solicitation_type: tipo,
    origin_name: originNameValue,
    origin_address: originAddressValue,
    origin_city: originCityValue,
    requester_address: isOutra ? (document.getElementById('wOutraEndereco').value || null) : null,
    requester_contact: isOutra ? (document.getElementById('wOutraTelefone').value || null) : currentRequesterContact(escolaId),
    requester_email: originEmailValue || (isOutra ? (document.getElementById('wOutraEmail').value || null) : null),
    turno: turnoFromHora(hora),
    destination: destinationValue,
    destination_address: destinationAddressValue,
    city: cityValue,
    departure_time: hora,
    return_time: document.getElementById('wHoraRetorno').value || null,
    students_count: parseInt(document.getElementById('wAlunos').value) || 0,
    companions_count: parseInt(document.getElementById('wAcompanhantes').value) || 0,
    pca_count: wizardPcdList.length,
    apoio_count: wizardPcdList.filter((p) => p.nome_apoio && p.nome_apoio.trim()).length,
    pcd_lista_enviada_em: wizardPcdList.length ? new Date().toISOString() : null,
    recurrence: recorrencia,
    selected_recurrence_dates: datasAdicionais,
    notes: document.getElementById('wObservacoes').value || null,
    status: 'pending',
    situacao: 'sem_validacao',
    atf_status: (cidadeEhForaDeNovaLima(cityValue) || cidadeEhForaDeNovaLima(originCityValue)) ? 'nao_emitida' : 'nao_precisa',
    publico_alvo: validationTargets.length ? null : (document.getElementById('wPublicoAlvo').value || null),
    setor_pedagogico_atual: validationTargets.length ? 'administracao' : setorPadraoPara(document.getElementById('wPublicoAlvo').value),
    validation_target_id: validationTargets.length ? (document.getElementById('wPublicoAlvo').value || null) : null,
    validation_sector_id: validationTargets.find((t) => t.id === document.getElementById('wPublicoAlvo').value)?.default_sector_id || null,
    doc_status: 'nao_enviado',
    requester_name: isOutra
      ? (document.getElementById('wOutraNome').value || null)
      : (currentUser?.user_metadata?.full_name || (currentUser?.email ? currentUser.email.split('@')[0] : null)),
    created_by: currentUser?.id || null,
  };

  let tripDates = [dataInicial];
  let recurrenceGroupId = null;
  if (recorrencia !== 'unico') {
    const weekdays = Array.from(document.querySelectorAll('input[name="wDiaSemana"]:checked')).map((el) => parseInt(el.value));
    const fim = document.getElementById('wRecorrenciaFim').value;
    const geradas = computeRecurrenceDates(dataInicial, fim, recorrencia, weekdays);
    tripDates = [...new Set([...(geradas.length ? geradas : [dataInicial]), ...datasAdicionais])].sort();
    recurrenceGroupId = newGroupId();
  }

  const novas = tripDates.map((d) => ({ ...base, trip_date: d, recurrence_group_id: recurrenceGroupId }));

  if (sb) {
    const { data, error } = await sb.from('excursions').insert(novas).select();
    if (error) { toast('❌ Erro ao salvar: ' + error.message, true); return; }
    primeiraViagemCriadaId = data?.[0]?.id || null;

    if (wizardPcdList.length && data && data.length) {
      const pcdRows = [];
      data.forEach((row) => {
        wizardPcdList.forEach((p) => pcdRows.push({
          excursion_id: row.id,
          nome_aluno: p.nome_aluno,
          cadeirante: !!p.cadeirante,
          documento_aluno: (p.documento_aluno || '').trim() || null,
          nome_apoio: p.nome_apoio || null,
          documento_apoio: (p.documento_apoio || '').trim() || null,
        }));
      });
      const { error: pcdErr } = await sb.from('excursion_pcd_students').insert(pcdRows);
      if (pcdErr) toast('⚠️ Viagem salva, mas houve erro ao salvar os alunos PCD: ' + pcdErr.message, true);
    }

    toast(novas.length > 1 ? `✅ ${novas.length} viagens da recorrência foram criadas!` : '✅ Solicitação enviada com sucesso!');
  } else {
    novas.forEach((nova, i) => {
      nova.id = 'e' + Date.now() + '_' + i;
      nova.pcd_students = wizardPcdList.map((p) => ({ ...p }));
      agenda.push(nova);
      if (i === 0) primeiraViagemCriadaId = nova.id;
    });
    saveDemoData();
    toast(novas.length > 1 ? `✅ ${novas.length} viagens da recorrência foram criadas (modo demo)!` : '✅ Solicitação enviada (modo demo)!');
  }

  await loadAgenda();
  renderDashboard();
  if (anexarProposta && primeiraViagemCriadaId) {
    resetWizard();
    openDocUploadModal(primeiraViagemCriadaId);
    toast('✅ Solicitação criada. Agora envie a proposta pedagógica.');
    return;
  }
  resetWizard();
  showScreen('solicitacao');
}

// ============ VEÍCULOS ============
let editVehicleId = null;

function renderVeiculos() {
  const podeEditar = currentUser?.role === 'admin' || (currentUser?.role === 'operacional' && canEditScreen('veiculos'));
  const grid = document.getElementById('veiculosGrid');
  if (vehicles.length === 0) {
    grid.innerHTML = '<p class="text-sm text-slate-500 col-span-full text-center py-8">Nenhum veículo cadastrado</p>';
    return;
  }
  grid.innerHTML = vehicles.map((v) => `
    <div class="bg-white rounded-xl border border-slate-200 p-5 card-hover">
      <div class="flex items-start justify-between mb-3">
        <div class="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center">
          <i data-lucide="bus" class="w-6 h-6 text-emerald-600"></i>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs bg-slate-100 px-2 py-1 rounded font-mono">${v.plate}</span>
          ${podeEditar ? `<button onclick="openVehicleModal('${v.id}')" class="text-xs text-emerald-600 hover:text-emerald-800">Editar</button>` : ''}
        </div>
      </div>
      <h3 class="font-semibold text-slate-800 capitalize">${(v.type || '').replace('-', ' ')}</h3>
      <p class="text-sm text-slate-500 mb-3">${v.cooperative || '-'}</p>
      <div class="flex items-center justify-between text-sm border-t border-slate-100 pt-3">
        <span class="text-slate-600"><i data-lucide="users" class="w-4 h-4 inline"></i> ${v.capacity} lugares</span>
        <span class="flex items-center gap-2">
          ${v.active === false ? '<span class="text-xs text-slate-400">Inativo</span>' : '<span class="text-xs text-emerald-600">Ativo</span>'}
          ${podeEditar && v.active === false
            ? `<button onclick="toggleVehicleActive('${v.id}')" class="text-xs text-emerald-600 hover:text-emerald-800">Reativar</button>`
            : podeEditar ? `<button onclick="toggleVehicleActive('${v.id}')" class="text-xs text-red-600 hover:text-red-800">Bloquear</button>` : ''}
        </span>
      </div>
    </div>
  `).join('');
  safeIcons();
}

// Bloquear = some das listas de "vincular a um motorista" (populateDriverVehicleSelect via
// active !== false) mas continua existindo pra viagens já atribuídas a ele. Excluir de
// verdade também é bloqueado pelo Postgres aqui: excursions.assigned_vehicle_id referencia
// vehicles sem cascade/set null (NO ACTION) - o banco recusaria apagar um veículo que já
// foi usado em alguma viagem, então bloquear é a única forma segura de "aposentar" um veículo.
async function toggleVehicleActive(id) {
  const v = vehicles.find((x) => x.id === id);
  if (!v) return;
  const novoActive = v.active === false;
  const patch = { active: novoActive };
  if (sb) {
    const { error } = await sb.from('vehicles').update(patch).eq('id', id);
    if (error) { toast('❌ ' + error.message, true); return; }
  } else {
    Object.assign(v, patch);
    saveDemoData();
  }
  await loadVehicles();
  renderVeiculos();
  toast(novoActive ? '✅ Veículo reativado.' : '🚫 Veículo bloqueado - não aparece mais pra vincular a novos motoristas.');
}

function openVehicleModal(id) {
  editVehicleId = id || null;
  const v = editVehicleId ? vehicles.find((x) => x.id === editVehicleId) : null;
  document.getElementById('newVeiculoPlaca').value = v ? v.plate : '';
  document.getElementById('newVeiculoTipo').value = v ? (v.type || 'micro-onibus') : 'micro-onibus';
  document.getElementById('newVeiculoCapacidade').value = v ? v.capacity : '';
  document.getElementById('newVeiculoCooperativa').value = v ? (v.cooperative || '') : '';
  document.getElementById('vehicleModalTitle').textContent = v ? '🚌 Editar veículo' : '🚌 Novo veículo';
  document.getElementById('vehicleModal').classList.remove('hidden');
}
function closeVehicleModal() { document.getElementById('vehicleModal').classList.add('hidden'); editVehicleId = null; }
async function confirmSaveVehicle() {
  const wasEdit = !!editVehicleId;
  const plate = document.getElementById('newVeiculoPlaca').value.trim();
  if (!plate) { toast('⚠️ Informe a placa.', true); return; }
  const patch = {
    plate,
    type: document.getElementById('newVeiculoTipo').value,
    capacity: parseInt(document.getElementById('newVeiculoCapacidade').value) || 0,
    cooperative: document.getElementById('newVeiculoCooperativa').value.trim() || null,
  };
  if (wasEdit) {
    if (sb) {
      const { error } = await sb.from('vehicles').update(patch).eq('id', editVehicleId);
      if (error) { toast('❌ ' + error.message, true); return; }
    } else {
      const v = vehicles.find((x) => x.id === editVehicleId);
      if (v) Object.assign(v, patch);
      saveDemoData();
    }
  } else {
    patch.active = true;
    if (sb) {
      const { error } = await sb.from('vehicles').insert([patch]);
      if (error) { toast('❌ ' + error.message, true); return; }
    } else {
      patch.id = 'v' + Date.now();
      vehicles.push(patch);
      saveDemoData();
    }
  }
  await loadVehicles();
  renderVeiculos();
  closeVehicleModal();
  toast(wasEdit ? '✅ Veículo atualizado!' : '✅ Veículo cadastrado!');
}

// ============ MOTORISTAS ============
let editDriverId = null;

function renderMotoristas() {
  const podeEditar = currentUser?.role === 'admin' || (currentUser?.role === 'operacional' && canEditScreen('motoristas'));
  const tbody = document.getElementById('motoristasTable');
  if (drivers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-500 text-sm">Nenhum motorista cadastrado</td></tr>';
    return;
  }
  const hoje = fmtDate(new Date());
  tbody.innerHTML = drivers.map((m) => {
    const v = driverVehicle(m.id);
    const cnhVencida = m.cnh_vencimento && m.cnh_vencimento < hoje;
    return `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-sm font-medium">${m.name}</td>
      <td class="px-4 py-3 text-sm font-mono text-xs">${m.cnh || '-'}</td>
      <td class="px-4 py-3 text-sm ${cnhVencida ? 'text-red-600 font-medium' : ''}">${m.cnh_vencimento ? new Date(m.cnh_vencimento + 'T00:00').toLocaleDateString('pt-BR') : '-'}${cnhVencida ? ' ⚠️' : ''}</td>
      <td class="px-4 py-3 text-sm">${m.phone || '-'}</td>
      <td class="px-4 py-3 text-sm">${cooperativaName(m)}</td>
      <td class="px-4 py-3 text-sm">${v ? `${v.plate} (${v.capacity} lug.)` : '<span class="text-slate-400">—</span>'}</td>
      <td class="px-4 py-3 text-sm whitespace-nowrap">
        ${m.active === false ? '<span class="bg-slate-100 text-slate-500 px-2 py-1 rounded text-xs font-medium">Inativo</span>' : '<span class="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-medium">Ativo</span>'}
        ${podeEditar ? `<button onclick="openDriverModal('${m.id}')" class="ml-2 text-xs text-emerald-600 hover:text-emerald-800">Editar</button>` : ''}
        ${podeEditar && m.active === false
          ? `<button onclick="toggleDriverActive('${m.id}')" class="ml-2 text-xs text-emerald-600 hover:text-emerald-800">Reativar</button>`
          : podeEditar ? `<button onclick="toggleDriverActive('${m.id}')" class="ml-2 text-xs text-red-600 hover:text-red-800">Bloquear</button>` : ''}
        ${podeEditar ? `<button onclick="deleteDriverSafely('${m.id}')" class="ml-2 text-xs text-red-600 hover:text-red-800">Excluir</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

// Bloquear = some das listas de "vincular a um veículo/nova viagem" (via active !== false
// nos filtros) mas o histórico de viagens já atribuídas a ele continua intacto. Excluir de
// verdade é bloqueado pelo próprio Postgres aqui: excursions.assigned_driver_id referencia
// drivers sem "on delete cascade"/"set null" (é NO ACTION), então tentar apagar um motorista
// que já dirigiu alguma viagem seria recusado pelo banco com erro de violação de chave
// estrangeira - bloquear é a forma segura e reversível de "desativar" um motorista.
async function toggleDriverActive(id) {
  const m = drivers.find((x) => x.id === id);
  if (!m) return;
  const novoActive = m.active === false;
  const patch = { active: novoActive };
  if (sb) {
    const { error } = await sb.from('drivers').update(patch).eq('id', id);
    if (error) { toast('❌ ' + error.message, true); return; }
  } else {
    Object.assign(m, patch);
    saveDemoData();
  }
  await loadDrivers();
  renderMotoristas();
  toast(novoActive ? '✅ Motorista reativado.' : '🚫 Motorista bloqueado - não aparece mais pra vincular a novas viagens.');
}

async function deleteDriverSafely(id) {
  const d = drivers.find((x) => x.id === id); if (!d) return;
  if (agenda.some((a) => (a.driver_ids || []).includes(id) || a.assigned_driver_id === id)) { toast('⚠️ Este motorista possui histórico de viagens. Use Bloquear para preservar o histórico.', true); return; }
  if (!window.confirm(`Excluir permanentemente o motorista ${d.name}? Esta ação não pode ser desfeita.`)) return;
  if (sb) { const { error } = await sb.from('drivers').delete().eq('id', id); if (error) { toast('❌ ' + error.message, true); return; } }
  else { drivers = drivers.filter((x) => x.id !== id); saveDemoData(); }
  await loadDrivers(); renderMotoristas(); toast('✅ Motorista excluído.');
}

function openDriverModal(id) {
  editDriverId = id || null;
  const m = editDriverId ? drivers.find((x) => x.id === editDriverId) : null;
  document.getElementById('newMotoristaNome').value = m ? m.name : '';
  document.getElementById('newMotoristaCnh').value = m ? (m.cnh || '') : '';
  document.getElementById('newMotoristaCnhVencimento').value = m ? (m.cnh_vencimento || '') : '';
  document.getElementById('newMotoristaTelefone').value = m ? (m.phone || '') : '';
  populateCooperativaSelect('newMotoristaCooperativaId', m ? m.cooperativa_id : '');
  const vSel = document.getElementById('newMotoristaVeiculo');
  if (vSel) {
    vSel.innerHTML = '<option value="">— nenhum —</option>' + vehicles.filter((v) => v.active !== false).map((v) => `<option value="${v.id}" ${m && m.vehicle_id === v.id ? 'selected' : ''}>${v.plate} (${v.capacity} lugares)</option>`).join('');
  }
  document.getElementById('driverModalTitle').textContent = m ? '👤 Editar motorista' : '👤 Novo motorista';
  document.getElementById('driverModal').classList.remove('hidden');
}
function closeDriverModal() { document.getElementById('driverModal').classList.add('hidden'); editDriverId = null; }
async function confirmSaveDriver() {
  const wasEdit = !!editDriverId;
  const name = document.getElementById('newMotoristaNome').value.trim();
  if (!name) { toast('⚠️ Informe o nome.', true); return; }
  const vSel = document.getElementById('newMotoristaVeiculo');
  const coopSel = document.getElementById('newMotoristaCooperativaId');
  const cooperativaId = (coopSel && coopSel.value) || null;
  const coop = cooperativaId ? cooperativas.find((c) => c.id === cooperativaId) : null;
  const patch = {
    name,
    cnh: document.getElementById('newMotoristaCnh').value.trim() || null,
    cnh_vencimento: document.getElementById('newMotoristaCnhVencimento').value || null,
    phone: document.getElementById('newMotoristaTelefone').value.trim() || null,
    cooperativa_id: cooperativaId,
    cooperative: coop ? coop.name : null, // mantido por compatibilidade com telas antigas
    vehicle_id: (vSel && vSel.value) || null,
  };
  if (wasEdit) {
    if (sb) {
      const { error } = await sb.from('drivers').update(patch).eq('id', editDriverId);
      if (error) { toast('❌ ' + error.message, true); return; }
    } else {
      const d = drivers.find((x) => x.id === editDriverId);
      if (d) Object.assign(d, patch);
      saveDemoData();
    }
  } else {
    patch.active = true;
    if (sb) {
      const { error } = await sb.from('drivers').insert([patch]);
      if (error) { toast('❌ ' + error.message, true); return; }
    } else {
      patch.id = 'd' + Date.now();
      drivers.push(patch);
      saveDemoData();
    }
  }
  await loadDrivers();
  renderMotoristas();
  closeDriverModal();
  toast(wasEdit ? '✅ Motorista atualizado!' : '✅ Motorista cadastrado!');
}

// ============ UNIDADES (escolas/entidades) ============
let editUnidadeId = null;

function renderUnidades() {
  const tbody = document.getElementById('unidadesTable');
  if (schools.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-500 text-sm">Nenhuma unidade cadastrada</td></tr>';
    return;
  }
  tbody.innerHTML = schools.map((s) => {
    const statusBadge = s.active === false
      ? '<span class="bg-slate-100 text-slate-500 px-2 py-1 rounded text-xs font-medium">Bloqueada</span>'
      : '<span class="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-medium">Ativa</span>';
    const toggleBtn = s.active === false
      ? `<button onclick="toggleSchoolActive('${s.id}')" class="ml-2 text-xs text-emerald-600 hover:text-emerald-800">Reativar</button>`
      : `<button onclick="toggleSchoolActive('${s.id}')" class="ml-2 text-xs text-red-600 hover:text-red-800">Bloquear</button>`;
    return `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-sm font-medium">${s.name}</td>
      <td class="px-4 py-3 text-sm">${s.tipo === 'entidade' ? 'Entidade' : 'Escola'}</td>
      <td class="px-4 py-3 text-sm">${s.address || '-'}<div class="text-xs text-slate-500">${s.city || '-'}</div></td>
      <td class="px-4 py-3 text-sm">${s.email || '-'}</td>
      <td class="px-4 py-3 text-sm">${s.phone || s.contact || '-'}</td>
      <td class="px-4 py-3 text-sm whitespace-nowrap">${statusBadge}<button onclick="openUnidadeModal('${s.id}')" class="ml-2 text-xs text-emerald-600 hover:text-emerald-800">Editar</button>${toggleBtn}<button onclick="deleteSchoolSafely('${s.id}')" class="ml-2 text-xs text-red-600 hover:text-red-800">Excluir</button></td>
    </tr>`;
  }).join('');
}

// Bloquear = some do seletor de unidade do wizard "Nova Solicitação" (não dá mais pra
// abrir viagem nova em nome dela) mas o histórico de viagens já feitas continua intacto.
// Excluir de verdade não é seguro aqui: profiles.school_id e excursions.school_id
// apontam pra schools com "on delete set null", ou seja, o Postgres deixaria excluir,
// mas toda viagem/usuário já ligado a essa unidade perderia essa informação de vez
// (viraria null) - bloquear evita essa perda de histórico e ainda é reversível.
async function toggleSchoolActive(id) {
  const s = schools.find((x) => x.id === id);
  if (!s) return;
  const novoActive = s.active === false;
  const patch = { active: novoActive };
  if (sb) {
    const { error } = await sb.from('schools').update(patch).eq('id', id);
    if (error) { toast('❌ ' + error.message, true); return; }
  } else {
    Object.assign(s, patch);
    saveDemoData();
  }
  await loadSchools();
  renderUnidades();
  toast(novoActive ? '✅ Unidade reativada.' : '🚫 Unidade bloqueada - não aparece mais pra novas solicitações.');
}

async function deleteSchoolSafely(id) {
  const s = schools.find((x) => x.id === id); if (!s) return;
  if (agenda.some((a) => a.school_id === id) || allProfiles.some((p) => p.school_id === id)) { toast('⚠️ Esta unidade possui viagens ou usuários vinculados. Use Bloquear para preservar o histórico.', true); return; }
  if (!window.confirm(`Excluir permanentemente a unidade ${s.name}? Esta ação não pode ser desfeita.`)) return;
  if (sb) { const { error } = await sb.from('schools').delete().eq('id', id); if (error) { toast('❌ ' + error.message, true); return; } }
  else { schools = schools.filter((x) => x.id !== id); saveDemoData(); }
  await loadSchools(); renderUnidades(); toast('✅ Unidade excluída.');
}

function openUnidadeModal(id) {
  editUnidadeId = id || null;
  const s = editUnidadeId ? schools.find((x) => x.id === editUnidadeId) : null;
  document.getElementById('newUnidadeNome').value = s ? s.name : '';
  document.getElementById('newUnidadeTipo').value = s ? s.tipo : 'escola';
  document.getElementById('newUnidadeEndereco').value = s ? (s.address || '') : '';
  document.getElementById('newUnidadeCidade').value = s ? (s.city || '') : '';
  document.getElementById('newUnidadeEmail').value = s ? (s.email || '') : '';
  document.getElementById('newUnidadeTelefone').value = s ? (s.phone || s.contact || '') : '';
  document.getElementById('unidadeModalTitle').textContent = s ? '🏫 Editar unidade' : '🏫 Nova unidade';
  document.getElementById('unidadeModal').classList.remove('hidden');
}
function closeUnidadeModal() { document.getElementById('unidadeModal').classList.add('hidden'); editUnidadeId = null; }
async function confirmSaveUnidade() {
  const wasEdit = !!editUnidadeId;
  const name = document.getElementById('newUnidadeNome').value.trim();
  if (!name) { toast('⚠️ Informe o nome da unidade.', true); return; }
  const patch = {
    name,
    tipo: document.getElementById('newUnidadeTipo').value,
    address: document.getElementById('newUnidadeEndereco').value.trim() || null,
    city: document.getElementById('newUnidadeCidade').value.trim() || null,
    email: document.getElementById('newUnidadeEmail').value.trim() || null,
    phone: document.getElementById('newUnidadeTelefone').value.trim() || null,
  };
  if (wasEdit) {
    if (sb) {
      const { error } = await sb.from('schools').update(patch).eq('id', editUnidadeId);
      if (error) { toast('❌ ' + error.message, true); return; }
    } else {
      const s = schools.find((x) => x.id === editUnidadeId);
      if (s) Object.assign(s, patch);
      saveDemoData();
    }
  } else {
    if (sb) {
      const { error } = await sb.from('schools').insert([patch]);
      if (error) { toast('❌ ' + error.message, true); return; }
    } else {
      patch.id = 's' + Date.now();
      schools.push(patch);
      saveDemoData();
    }
  }
  await loadSchools();
  renderUnidades();
  closeUnidadeModal();
  toast(wasEdit ? '✅ Unidade atualizada!' : '✅ Unidade cadastrada!');
}

// ============ COOPERATIVAS + CONFIGURAÇÕES DE E-MAIL ============
let editCooperativaId = null;

function renderCooperativas() {
  const tbody = document.getElementById('cooperativasTable');
  if (cooperativas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-500 text-sm">Nenhuma cooperativa cadastrada</td></tr>';
    return;
  }
  tbody.innerHTML = cooperativas.map((c) => {
    const statusBadge = c.active === false
      ? '<span class="bg-slate-100 text-slate-500 px-2 py-1 rounded text-xs font-medium">Bloqueada</span>'
      : '<span class="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-medium">Ativa</span>';
    const toggleBtn = c.active === false
      ? `<button onclick="toggleCooperativaActive('${c.id}')" class="ml-2 text-xs text-emerald-600 hover:text-emerald-800">Reativar</button>`
      : `<button onclick="toggleCooperativaActive('${c.id}')" class="ml-2 text-xs text-red-600 hover:text-red-800">Bloquear</button>`;
    return `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-sm font-medium">${c.name}</td>
      <td class="px-4 py-3 text-sm">${c.email || '<span class="text-amber-600">sem e-mail cadastrado</span>'}</td>
      <td class="px-4 py-3 text-sm">${c.phone || '-'}</td>
      <td class="px-4 py-3 text-sm whitespace-nowrap">${statusBadge}<button onclick="openCooperativaModal('${c.id}')" class="ml-2 text-xs text-emerald-600 hover:text-emerald-800">Editar</button>${toggleBtn}</td>
    </tr>`;
  }).join('');
}

// Bloquear = some das listas de "vincular a um motorista novo" (populateCooperativaSelect)
// mas continua existindo pra viagens já enviadas a ela (histórico/relatórios). Exclusão de
// verdade fica arriscada aqui também: drivers.cooperativa_id referencia cooperativas sem
// problema de FK (on delete set null), mas apagar perderia esse vínculo de motoristas que
// já usaram essa cooperativa - bloquear preserva o histórico sem impedir reverter depois.
async function toggleCooperativaActive(id) {
  const c = cooperativas.find((x) => x.id === id);
  if (!c) return;
  const novoActive = c.active === false;
  const patch = { active: novoActive };
  if (sb) {
    const { error } = await sb.from('cooperativas').update(patch).eq('id', id);
    if (error) { toast('❌ ' + error.message, true); return; }
  } else {
    Object.assign(c, patch);
    saveDemoData();
  }
  await loadCooperativas();
  renderCooperativas();
  toast(novoActive ? '✅ Cooperativa reativada.' : '🚫 Cooperativa bloqueada - não aparece mais pra vincular a novos motoristas.');
}

function openCooperativaModal(id) {
  editCooperativaId = id || null;
  const c = editCooperativaId ? cooperativas.find((x) => x.id === editCooperativaId) : null;
  document.getElementById('newCooperativaNome').value = c ? c.name : '';
  document.getElementById('newCooperativaEmail').value = c ? (c.email || '') : '';
  document.getElementById('newCooperativaTelefone').value = c ? (c.phone || '') : '';
  document.getElementById('cooperativaModalTitle').textContent = c ? '📨 Editar cooperativa' : '📨 Nova cooperativa';
  document.getElementById('cooperativaModal').classList.remove('hidden');
}
function closeCooperativaModal() { document.getElementById('cooperativaModal').classList.add('hidden'); editCooperativaId = null; }
async function confirmSaveCooperativa() {
  const wasEdit = !!editCooperativaId;
  const name = document.getElementById('newCooperativaNome').value.trim();
  if (!name) { toast('⚠️ Informe o nome da cooperativa.', true); return; }
  const patch = {
    name,
    email: document.getElementById('newCooperativaEmail').value.trim() || null,
    phone: document.getElementById('newCooperativaTelefone').value.trim() || null,
  };
  if (wasEdit) {
    if (sb) {
      const { error } = await sb.from('cooperativas').update(patch).eq('id', editCooperativaId);
      if (error) { toast('❌ ' + error.message, true); return; }
    } else {
      const c = cooperativas.find((x) => x.id === editCooperativaId);
      if (c) Object.assign(c, patch);
      saveDemoData();
    }
  } else {
    if (sb) {
      const { error } = await sb.from('cooperativas').insert([patch]);
      if (error) { toast('❌ ' + error.message, true); return; }
    } else {
      patch.id = 'c' + Date.now();
      cooperativas.push(patch);
      saveDemoData();
    }
  }
  await loadCooperativas();
  renderCooperativas();
  closeCooperativaModal();
  toast(wasEdit ? '✅ Cooperativa atualizada!' : '✅ Cooperativa cadastrada!');
}

function fillSettingsForm() {
  document.getElementById('settingsRemetenteNome').value = appSettings.remetente_nome || '';
  document.getElementById('settingsRemetenteEmail').value = appSettings.remetente_email || '';
  document.getElementById('settingsDriveUploadUrl').value = appSettings.drive_upload_url || '';
}
async function confirmSaveSettings() {
  const nome = document.getElementById('settingsRemetenteNome').value.trim();
  const email = document.getElementById('settingsRemetenteEmail').value.trim();
  const driveUrl = document.getElementById('settingsDriveUploadUrl').value.trim();
  if (sb) {
    const { error: e1 } = await sb.from('app_settings').upsert({ key: 'remetente_nome', value: nome });
    const { error: e2 } = await sb.from('app_settings').upsert({ key: 'remetente_email', value: email });
    const { error: e3 } = await sb.from('app_settings').upsert({ key: 'drive_upload_url', value: driveUrl });
    if (e1 || e2 || e3) { toast('❌ Erro ao salvar configurações: ' + ((e1 || e2 || e3).message), true); return; }
  }
  appSettings = { remetente_nome: nome, remetente_email: email, drive_upload_url: driveUrl };
  if (!sb) saveDemoData();
  toast('✅ Configurações salvas!');
}

// ============ PDF ============
// ============ RELATÓRIOS (filtros próprios: período + unidade) ============
function populateUnidadeFilterSelect(selId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todas</option>'
    + schools.filter((s) => s.tipo !== 'entidade').map((s) => `<option value="${s.id}">${s.name}</option>`).join('')
    + '<option value="__OUTROS__">Entidade / Outro</option>';
  sel.value = atual;
}

function populateRelatorioFilters() { populateUnidadeFilterSelect('relFiltroUnidade'); }

function filterRelatorio() {
  const inicio = document.getElementById('relFiltroInicio').value;
  const fim = document.getElementById('relFiltroFim').value;
  const unidade = document.getElementById('relFiltroUnidade').value;
  return getVisibleAgenda().filter((a) => {
    if (inicio && a.trip_date < inicio) return false;
    if (fim && a.trip_date > fim) return false;
    if (unidade && origemFiltroId(a) !== unidade) return false;
    return viagemConfirmadaParaMotorista(a) && (a.driver_ids || []).length > 0;
  });
}

function exportEscalaPDF() {
  if (!window.jspdf) {
    toast('⚠️ Não foi possível carregar o gerador de PDF (verifique sua internet) e tente novamente.', true);
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const rows = filterRelatorio().sort((a, b) => (a.trip_date + a.departure_time).localeCompare(b.trip_date + b.departure_time));
  const inicio = document.getElementById('relFiltroInicio').value;
  const fim = document.getElementById('relFiltroFim').value;
  const periodo = inicio || fim
    ? `${inicio ? new Date(inicio + 'T00:00').toLocaleDateString('pt-BR') : '…'} a ${fim ? new Date(fim + 'T00:00').toLocaleDateString('pt-BR') : '…'}`
    : 'Todas as datas';

  doc.setFillColor(5, 150, 105);
  doc.rect(0, 0, 297, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('BORA LÁ - EXCURSÕES | ESCALA DE TRANSPORTE', 10, 11);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Semed - Nova Lima/MG', 287, 11, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  doc.autoTable({
    startY: 23,
    body: [['PERÍODO', periodo, 'VIAGENS', String(rows.length)]],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, textColor: [0, 0, 0] },
    columnStyles: { 0: { fillColor: [34, 211, 238], fontStyle: 'bold', cellWidth: 25 }, 1: { cellWidth: 80 }, 2: { fillColor: [34, 211, 238], fontStyle: 'bold', cellWidth: 25 }, 3: { cellWidth: 20 } },
  });
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 5,
    head: [['TURNO', 'SAÍDA', 'RETORNO', 'ORIGEM', 'ENDEREÇO ORIGEM', 'DESTINO', 'ENDEREÇO DESTINO', 'PAX', 'ATF', 'MOTORISTA']],
    body: rows.map((a) => [
      TURNO_LABELS[a.turno || turnoFromHora(a.departure_time)] || '-',
      hhmm(a.departure_time), hhmm(a.return_time), originName(a), originAddress(a) || '-',
      a.destination || '-', a.destination_address || a.city || '-', String(totalPassengers(a)),
      ATF_LABELS[a.atf_status] || a.atf_status || '-',
      (a.driver_ids || []).map(driverLabel).join('\n'),
    ]),
    theme: 'grid',
    styles: { fontSize: 6.5, cellPadding: 1.25, valign: 'middle', lineColor: [148, 163, 184], lineWidth: .15 },
    headStyles: { fillColor: [250, 204, 21], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', fontSize: 6.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0:{cellWidth:13}, 1:{cellWidth:12}, 2:{cellWidth:13}, 3:{cellWidth:30}, 4:{cellWidth:40}, 5:{cellWidth:30}, 6:{cellWidth:40}, 7:{cellWidth:10,halign:'center'}, 8:{cellWidth:18}, 9:{cellWidth:30} },
  });

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')} - Página ${i} de ${pages}`, 14, 290);
  }

  doc.save(`bora-la-escala-${Date.now()}.pdf`);
  toast('📄 Escala em PDF gerada com sucesso!');
}

function exportEscalaExcel() {
  if (!window.XLSX) {
    toast('⚠️ Não foi possível carregar o gerador de Excel (verifique sua internet) e tente novamente.', true);
    return;
  }
  const rows = filterRelatorio().sort((a, b) => (a.trip_date + a.departure_time).localeCompare(b.trip_date + b.departure_time));
  const data = rows.map((a) => ({
    Data: new Date(a.trip_date + 'T00:00').toLocaleDateString('pt-BR'),
    Turno: TURNO_LABELS[a.turno || turnoFromHora(a.departure_time)] || '-',
    'Saída': hhmm(a.departure_time),
    'Retorno': hhmm(a.return_time),
    Origem: originName(a),
    'Endereço origem': originAddress(a) || '-',
    Destino: a.destination,
    'Endereço destino': a.destination_address || a.city || '-',
    Passageiros: totalPassengers(a),
    ATF: ATF_LABELS[a.atf_status] || a.atf_status,
    Motorista: (a.driver_ids || []).map(driverLabel).join(' / '),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Escala');
  XLSX.writeFile(wb, `bora-la-escala-${Date.now()}.xlsx`);
  toast('📊 Escala em Excel gerada com sucesso!');
}

// Nomes antigos mantidos somente para atalhos salvos de versões anteriores.
function exportPDF() { exportEscalaPDF(); }
function exportExcel() { exportEscalaExcel(); }

// ============ TOAST ============
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  const m = document.getElementById('toastMsg');
  m.textContent = msg;
  m.className = 'text-sm font-medium ' + (isError ? 'text-red-600' : 'text-slate-800');
  t.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ============ SERVICE WORKER (PWA) ============
// O Service Worker do app inteiro (sw.js) continua desativado: o cache dele fazia
// alguns navegadores mostrarem versões antigas do app mesmo depois de corrigidas, sem
// nenhum aviso disso acontecendo. Este bloco remove automaticamente, de qualquer
// aparelho que abrir o site, qualquer Service Worker/cache de visitas antigas — exceto
// o Service Worker novo e propositalmente "sem cache de HTML/JS" do app instalável do
// Motorista (sw-motorista.js, registrado só por motorista.html - ver função
// maybeRegisterMotoristaPwa acima), que não tem esse problema.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => {
      const scriptUrl = (reg.active && reg.active.scriptURL) || (reg.installing && reg.installing.scriptURL) || (reg.waiting && reg.waiting.scriptURL) || '';
      if (!scriptUrl.includes('sw-motorista.js')) reg.unregister();
    });
  });
}
if (window.caches && caches.keys) {
  caches.keys().then((keys) => keys.forEach((k) => { if (k !== 'bora-la-motorista-v1') caches.delete(k); }));
}
