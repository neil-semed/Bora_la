// ============================================================
// BORA LÁ - EXCURSÕES | Com Supabase configurado
// ============================================================

// 🔑 CREDENCIAIS DO SUPABASE (já configuradas)
const SUPABASE_URL = 'https://rjuzhscynuleypaewgak.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqdXpoc2N5bnVsZXlwYWV3Z2FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NTQwNDAsImV4cCI6MjEwNDIzMDA0MH0.enT2gJB4dy2xz_Z91tPY4ysoJ-GEEn2dpo_RHiy5jAs';

let supabase = null;
let currentUser = null;
let wizardStep = 1;
let agenda = [];

// ============ INICIALIZAÇÃO ============
document.addEventListener('DOMContentLoaded', () => {
  initSupabase();
  checkAuth();
  
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  
  // Formulário de solicitação simplificado
  const solForm = document.getElementById('solicitacaoForm');
  if (solForm) {
    solForm.addEventListener('submit', submitSolicitacaoSimples);
  }
});

// ============ SUPABASE ============
function initSupabase() {
  try {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Supabase conectado com sucesso!');
  } catch (e) {
    console.error('❌ Erro ao conectar Supabase:', e);
    toast('❌ Erro ao conectar com o banco de dados');
  }
}

// ============ AUTENTICAÇÃO ============
async function checkAuth() {
  if (!supabase) return;
  
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    await loadUserProfile();
    enterApp();
  }
}

async function loadUserProfile() {
  if (!supabase || !currentUser) return;
  
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .single();
  
  if (data) {
    currentUser.role = data.role;
    currentUser.user_metadata = { full_name: data.full_name };
  } else {
    currentUser.role = 'admin';
  }
}

// ============ LOGIN ============
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  if (!supabase) {
    toast('❌ Supabase não conectado');
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  
  if (error) {
    toast('❌ ' + error.message);
    return;
  }
  
  currentUser = data.user;
  await loadUserProfile();
  enterApp();
}

function enterApp() {
  document.getElementById('loginScreen').classList.add('hidden-screen');
  document.getElementById('appScreen').classList.remove('hidden-screen');
  document.getElementById('appScreen').classList.add('active-screen');

  const name = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
  document.getElementById('userRole').textContent = (currentUser.role || 'admin').toUpperCase();
  document.getElementById('userInfo').textContent = currentUser.email;

  renderDashboard();
  renderAgenda();
  renderVeiculos();
  renderMotoristas();
}

async function logout() {
  if (supabase) await supabase.auth.signOut();
  currentUser = null;
  document.getElementById('appScreen').classList.add('hidden-screen');
  document.getElementById('loginScreen').classList.remove('hidden-screen');
  document.getElementById('loginScreen').classList.add('active-screen');
}

// ============ NAVEGAÇÃO ============
function showScreen(name) {
  document.querySelectorAll('[id^="screen-"]').forEach(el => {
    el.classList.add('hidden-screen');
    el.classList.remove('active-screen');
  });
  const target = document.getElementById('screen-' + name);
  if (target) {
    target.classList.remove('hidden-screen');
    target.classList.add('active-screen');
  }

  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  event?.currentTarget?.classList.add('active');

  const titles = {
    dashboard: ['Dashboard', 'Visão geral do sistema'],
    agenda: ['Agenda', 'Todas as viagens'],
    solicitacao: ['Nova Solicitação', 'Criar nova excursão'],
    veiculos: ['Veículos', 'Frota disponível'],
    motoristas: ['Motoristas', 'Cadastro de motoristas'],
  };
  document.getElementById('pageTitle').textContent = titles[name]?.[0] || '';
  document.getElementById('pageSubtitle').textContent = titles[name]?.[1] || '';
}

// ============ DASHBOARD ============
async function renderDashboard() {
  if (!supabase) return;

  const { data: excursions } = await supabase
    .from('excursions')
    .select('*')
    .order('trip_date', { ascending: true });
  
  agenda = excursions || [];

  const hoje = new Date().toISOString().split('T')[0];
  const viagensHoje = agenda.filter(a => a.trip_date === hoje).length;
  const pendentes = agenda.filter(a => a.status === 'pending').length;
  const aprovadas = agenda.filter(a => a.status === 'approved').length;
  const alunos = agenda.reduce((s, a) => s + (a.students_count || 0), 0);

  document.getElementById('statHoje').textContent = viagensHoje;
  document.getElementById('statPendentes').textContent = pendentes;
  document.getElementById('statAprovadas').textContent = aprovadas;
  document.getElementById('statAlunos').textContent = alunos;
}

// ============ AGENDA ============
async function renderAgenda() {
  if (!supabase) return;

  const { data: excursions } = await supabase
    .from('excursions')
    .select('*, schools(name)')
    .order('trip_date', { ascending: true });
  
  agenda = excursions || [];

  const container = document.getElementById('agendaList');
  
  if (agenda.length === 0) {
    container.innerHTML = '<p class="text-slate-500 text-center py-8">Nenhuma viagem agendada</p>';
    return;
  }

  container.innerHTML = agenda.map(a => `
    <div class="flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50">
      <div>
        <div class="font-medium">${a.destination}</div>
        <div class="text-sm text-slate-500">
          ${new Date(a.trip_date + 'T00:00').toLocaleDateString('pt-BR')} às ${a.departure_time} • 
          ${a.students_count} alunos
        </div>
      </div>
      <span class="px-2 py-1 rounded text-xs font-medium ${getStatusClass(a.status)}">
        ${statusLabel(a.status)}
      </span>
    </div>
  `).join('');
}

function getStatusClass(status) {
  const classes = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-800',
    transit: 'bg-blue-100 text-blue-800',
    rejected: 'bg-red-100 text-red-800'
  };
  return classes[status] || 'bg-slate-100 text-slate-800';
}

function statusLabel(s) {
  return { pending: 'Pendente', approved: 'Aprovada', transit: 'Em trânsito', rejected: 'Recusada' }[s] || s;
}

// ============ SOLICITAÇÃO ============
async function submitSolicitacaoSimples(e) {
  e.preventDefault();
  
  if (!supabase) {
    toast('❌ Supabase não conectado');
    return;
  }

  const nova = {
    destination: document.getElementById('solDestino').value,
    city: document.getElementById('solCidade').value,
    trip_date: document.getElementById('solData').value,
    departure_time: document.getElementById('solHora').value,
    students_count: parseInt(document.getElementById('solAlunos').value),
    status: 'pending',
    created_by: currentUser?.id
  };

  const { error } = await supabase.from('excursions').insert([nova]);
  
  if (error) {
    toast('❌ Erro ao salvar: ' + error.message);
    return;
  }

  toast('✅ Solicitação enviada com sucesso!');
  e.target.reset();
  
  await renderDashboard();
  await renderAgenda();
  showScreen('agenda');
}

// ============ VEÍCULOS ============
async function renderVeiculos() {
  if (!supabase) return;

  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('*')
    .order('plate');

  const container = document.getElementById('veiculosList');
  
  if (!vehicles || vehicles.length === 0) {
    container.innerHTML = '<p class="text-slate-500">Nenhum veículo cadastrado</p>';
    return;
  }

  container.innerHTML = vehicles.map(v => `
    <div class="bg-white rounded-xl border p-5">
      <div class="flex items-start justify-between mb-3">
        <div class="text-3xl">🚌</div>
        <span class="text-xs bg-slate-100 px-2 py-1 rounded font-mono">${v.plate}</span>
      </div>
      <h3 class="font-semibold">${v.type}</h3>
      <p class="text-sm text-slate-500 mb-3">${v.cooperative || '-'}</p>
      <div class="text-sm">
        <span>${v.capacity} lugares</span>
      </div>
    </div>
  `).join('');
}

// ============ MOTORISTAS ============
async function renderMotoristas() {
  if (!supabase) return;

  const { data: drivers } = await supabase
    .from('drivers')
    .select('*')
    .order('name');

  const container = document.getElementById('motoristasList');
  
  if (!drivers || drivers.length === 0) {
    container.innerHTML = '<p class="text-slate-500">Nenhum motorista cadastrado</p>';
    return;
  }

  container.innerHTML = drivers.map(m => `
    <div class="flex items-center justify-between p-3 border rounded-lg">
      <div>
        <div class="font-medium">${m.name}</div>
        <div class="text-sm text-slate-500">CNH: ${m.cnh} • ${m.phone || '-'}</div>
      </div>
      <span class="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs">Ativo</span>
    </div>
  `).join('');
}

// ============ TOAST ============
function toast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

// ============ CONFIG (não precisa mais, mas mantemos) ============
function showConfig() {
  document.getElementById('configModal').classList.remove('hidden');
}

function closeConfig() {
  document.getElementById('configModal').classList.add('hidden');
}

function saveConfig() {
  toast('✅ Credenciais já estão configuradas no código!');
  closeConfig();
}
