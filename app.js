// ============================================================
// BORA LÁ - EXCURSÕES | Lógica principal com Supabase
// ============================================================

let supabase = null;
let currentUser = null;
let wizardStep = 1;
let agenda = [];

// ============ INICIALIZAÇÃO ============
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initSupabase();
  checkAuth();
  
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('filtroData').value = new Date().toISOString().split('T')[0];
});

// ============ SUPABASE ============
function initSupabase() {
  const url = localStorage.getItem('sb_url');
  const key = localStorage.getItem('sb_key');

  if (url && key) {
    try {
      supabase = window.supabase.createClient(url, key);
      console.log('✅ Supabase conectado');
    } catch (e) {
      console.warn('⚠️ Erro ao conectar Supabase:', e);
    }
  } else {
    console.log('ℹ️ Supabase não configurado - usando modo demo');
  }
}

function showConfig() {
  document.getElementById('configModal').classList.remove('hidden');
  document.getElementById('cfgUrl').value = localStorage.getItem('sb_url') || '';
  document.getElementById('cfgKey').value = localStorage.getItem('sb_key') || '';
}

function closeConfig() {
  document.getElementById('configModal').classList.add('hidden');
}

function saveConfig() {
  const url = document.getElementById('cfgUrl').value.trim();
  const key = document.getElementById('cfgKey').value.trim();
  if (url && key) {
    localStorage.setItem('sb_url', url);
    localStorage.setItem('sb_key', key);
    initSupabase();
    closeConfig();
    toast('✅ Supabase configurado! Recarregue a página.');
    setTimeout(() => location.reload(), 1500);
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
    currentUser.role = 'admin'; // fallback
  }
}

// ============ LOGIN ============
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast('❌ ' + error.message, true);
      return;
    }
    currentUser = data.user;
    await loadUserProfile();
  } else {
    // Modo demo
    const role = detectRole(email);
    currentUser = {
      id: 'demo-' + Date.now(),
      email: email,
      role: role,
      user_metadata: { full_name: email.split('@')[0] }
    };
  }

  enterApp();
}

function detectRole(email) {
  const lower = email.toLowerCase();
  if (lower.includes('admin')) return 'admin';
  if (lower.includes('pedagogia')) return 'pedagogia';
  if (lower.includes('motorista')) return 'motorista';
  if (lower.includes('escola')) return 'escola';
  return 'admin';
}

function enterApp() {
  document.getElementById('loginScreen').classList.add('hidden-screen');
  document.getElementById('appScreen').classList.remove('hidden-screen');
  document.getElementById('appScreen').classList.add('active-screen');

  const name = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
  document.getElementById('userRole').textContent = (currentUser.role || 'admin').toUpperCase();
  document.getElementById('userInfo').textContent = currentUser.email;
  document.getElementById('userAvatar').textContent = name[0].toUpperCase();

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
    agenda: ['Agenda Mestra', 'Todas as viagens ordenadas por data/hora'],
    solicitacao: ['Nova Solicitação', 'Wizard de cadastro de excursão'],
    veiculos: ['Veículos', 'Frota disponível'],
    motoristas: ['Motoristas', 'Cadastro de motoristas e cooperativas'],
    relatorios: ['Relatórios', 'Geração de PDFs e documentos'],
  };
  document.getElementById('pageTitle').textContent = titles[name]?.[0] || '';
  document.getElementById('pageSubtitle').textContent = titles[name]?.[1] || '';
}

// ============ DASHBOARD ============
async function renderDashboard() {
  if (supabase) {
    // Carregar dados reais do Supabase
    const { data: excursions } = await supabase
      .from('excursions')
      .select('*')
      .order('trip_date', { ascending: true });
    
    agenda = excursions || [];
  }

  const hoje = new Date().toISOString().split('T')[0];
  const viagensHoje = agenda.filter(a => a.trip_date === hoje).length;
  const pendentes = agenda.filter(a => a.status === 'pending').length;
  const aprovadas = agenda.filter(a => a.status === 'approved').length;
  const alunos = agenda.reduce((s, a) => s + (a.students_count || 0), 0);

  document.getElementById('statHoje').textContent = viagensHoje;
  document.getElementById('statPendentes').textContent = pendentes;
  document.getElementById('statAprovadas').textContent = aprovadas;
  document.getElementById('statAlunos').textContent = alunos;

  const proximas = agenda
    .filter(a => a.trip_date >= hoje)
    .sort((a, b) => (a.trip_date + a.departure_time).localeCompare(b.trip_date + b.departure_time))
    .slice(0, 5);

  const container = document.getElementById('proximasViagens');
  if (proximas.length === 0) {
    container.innerHTML = '<p class="text-sm text-slate-500 text-center py-8">Nenhuma viagem agendada</p>';
    return;
  }

  container.innerHTML = proximas.map(a => `
    <div class="flex items-center justify-between p-3 border border-slate-100 rounded-lg hover:bg-slate-50">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-lg bg-emerald-100 flex flex-col items-center justify-center">
          <span class="text-xs text-emerald-700 font-semibold">${new Date(a.trip_date + 'T00:00').toLocaleDateString('pt-BR', { month: 'short' })}</span>
          <span class="text-lg font-bold text-emerald-800">${new Date(a.trip_date + 'T00:00').getDate()}</span>
        </div>
        <div>
          <div class="font-medium text-slate-800">${a.destination}</div>
          <div class="text-xs text-slate-500">${a.departure_time} • ${a.students_count} alunos</div>
        </div>
      </div>
      <span class="status-${a.status} px-2 py-1 rounded text-xs font-medium">${statusLabel(a.status)}</span>
    </div>
  `).join('');
}

function statusLabel(s) {
  return { pending: 'Pendente', approved: 'Aprovada', transit: 'Em trânsito', rejected: 'Recusada', completed: 'Concluída' }[s] || s;
}

// ============ AGENDA ============
async function renderAgenda() {
  if (supabase) {
    const { data: excursions } = await supabase
      .from('excursions')
      .select('*, schools(name)')
      .order('trip_date', { ascending: true });
    
    agenda = excursions || [];
  }

  const filtered = filterAgenda();
  const tbody = document.getElementById('agendaTable');

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-500 text-sm">Nenhuma viagem encontrada</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.sort((a, b) => (a.trip_date + a.departure_time).localeCompare(b.trip_date + b.departure_time)).map(a => `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-sm">
        <div class="font-medium">${new Date(a.trip_date + 'T00:00').toLocaleDateString('pt-BR')}</div>
        <div class="text-xs text-slate-500">${a.departure_time}</div>
      </td>
      <td class="px-4 py-3 text-sm">${a.schools?.name || '-'}</td>
      <td class="px-4 py-3 text-sm">
        <div>${a.destination}</div>
        <div class="text-xs text-slate-500">${a.city || '-'}</div>
      </td>
      <td class="px-4 py-3 text-sm font-medium">${a.students_count}</td>
      <td class="px-4 py-3 text-sm text-xs">A definir</td>
      <td class="px-4 py-3"><span class="status-${a.status} px-2 py-1 rounded text-xs font-medium">${statusLabel(a.status)}</span></td>
      <td class="px-4 py-3">
        <button onclick="aprovarViagem('${a.id}')" class="text-emerald-600 hover:text-emerald-800 text-xs font-medium">Aprovar</button>
      </td>
    </tr>
  `).join('');
}

function filterAgenda() {
  const data = document.getElementById('filtroData').value;
  const status = document.getElementById('filtroStatus').value;

  return agenda.filter(a => {
    if (data && a.trip_date !== data) return false;
    if (status && a.status !== status) return false;
    return true;
  });
}

function filtrarAgenda() { renderAgenda(); }

async function aprovarViagem(id) {
  if (supabase) {
    const { error } = await supabase
      .from('excursions')
      .update({ status: 'approved' })
      .eq('id', id);
    
    if (error) {
      toast('❌ Erro ao aprovar: ' + error.message, true);
      return;
    }
  }

  const v = agenda.find(a => a.id === id);
  if (v) v.status = 'approved';
  
  renderAgenda();
  renderDashboard();
  toast('✅ Viagem aprovada!');
}

// ============ WIZARD ============
function wizardNext() {
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
  if (wizardStep > 1) {
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
    if (wizardStep === 1) document.getElementById('btnPrev').classList.add('hidden');
  }
}

function renderResumo() {
  const escola = document.getElementById('wEscola').value;
  const destino = document.getElementById('wDestino').value;
  const cidade = document.getElementById('wCidade').value;
  const data = document.getElementById('wData').value;
  const hora = document.getElementById('wHora').value;
  const alunos = parseInt(document.getElementById('wAlunos').value) || 0;
  const acompanhantes = parseInt(document.getElementById('wAcompanhantes').value) || 0;
  const recorrencia = document.querySelector('input[name="wRecorrencia"]:checked').value;

  document.getElementById('resumoSolicitacao').innerHTML = `
    <div><strong>Escola:</strong> ${escola || '-'}</div>
    <div><strong>Destino:</strong> ${destino || '-'} (${cidade || '-'})</div>
    <div><strong>Data/Hora:</strong> ${data ? new Date(data + 'T00:00').toLocaleDateString('pt-BR') : '-'} às ${hora || '-'}</div>
    <div><strong>Alunos:</strong> ${alunos} + ${acompanhantes} acompanhantes = <strong>${alunos + acompanhantes} pessoas</strong></div>
    <div><strong>Tipo:</strong> ${recorrencia === 'unico' ? 'Evento Único' : 'Continuado ' + recorrencia}</div>
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
    const foraMunicipio = cidade && !cidade.toLowerCase().includes('nova lima');
    if (foraMunicipio) sug += `<br/>⚠️ Viagem FORA de Nova Lima - será necessária <strong>ATF</strong>`;
  }
  document.getElementById('sugestaoVeiculos').innerHTML = sug;
}

async function submitSolicitacao() {
  const nova = {
    school_id: null, // TODO: mapear escola selecionada
    destination: document.getElementById('wDestino').value,
    city: document.getElementById('wCidade').value,
    trip_date: document.getElementById('wData').value,
    departure_time: document.getElementById('wHora').value,
    students_count: parseInt(document.getElementById('wAlunos').value) || 0,
    companions_count: parseInt(document.getElementById('wAcompanhantes').value) || 0,
    recurrence: document.querySelector('input[name="wRecorrencia"]:checked').value,
    status: 'pending',
    created_by: currentUser?.id
  };

  if (supabase) {
    const { error } = await supabase.from('excursions').insert([nova]);
    if (error) {
      toast('❌ Erro ao salvar: ' + error.message, true);
      return;
    }
    toast('✅ Solicitação enviada com sucesso!');
  } else {
    nova.id = Date.now();
    nova.trip_date = nova.trip_date;
    agenda.push(nova);
    toast('✅ Solicitação enviada (modo demo)!');
  }

  // Reset wizard
  wizardStep = 1;
  for (let i = 1; i <= 5; i++) {
    document.getElementById('step' + i).classList.add('hidden');
    document.getElementById('prog' + i).className = i === 1 ? 'h-1.5 flex-1 bg-emerald-500 rounded' : 'h-1.5 flex-1 bg-slate-200 rounded';
  }
  document.getElementById('step1').classList.remove('hidden');
  document.getElementById('wizardStep').textContent = 1;
  document.getElementById('btnPrev').classList.add('hidden');
  document.getElementById('btnNext').textContent = 'Próximo →';

  await renderDashboard();
  await renderAgenda();
  showScreen('agenda');
}

// ============ VEÍCULOS ============
async function renderVeiculos() {
  let vehicles = [];
  
  if (supabase) {
    const { data } = await supabase.from('vehicles').select('*').order('plate');
    vehicles = data || [];
  } else {
    vehicles = [
      { plate: 'ABC-1234', type: 'Micro-ônibus', capacity: 32, cooperative: 'CoopTrans' },
      { plate: 'DEF-5678', type: 'Van', capacity: 15, cooperative: 'CoopTrans' },
      { plate: 'GHI-9012', type: 'Micro-ônibus', capacity: 32, cooperative: 'TransNova' },
    ];
  }

  const grid = document.getElementById('veiculosGrid');
  grid.innerHTML = vehicles.map(v => `
    <div class="bg-white rounded-xl border border-slate-200 p-5 card-hover">
      <div class="flex items-start justify-between mb-3">
        <div class="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center">
          <i data-lucide="bus" class="w-6 h-6 text-emerald-600"></i>
        </div>
        <span class="text-xs bg-slate-100 px-2 py-1 rounded font-mono">${v.plate}</span>
      </div>
      <h3 class="font-semibold text-slate-800">${v.type}</h3>
      <p class="text-sm text-slate-500 mb-3">${v.cooperative || '-'}</p>
      <div class="flex items-center justify-between text-sm border-t border-slate-100 pt-3">
        <span class="text-slate-600"><i data-lucide="users" class="w-4 h-4 inline"></i> ${v.capacity} lugares</span>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

// ============ MOTORISTAS ============
async function renderMotoristas() {
  let drivers = [];
  
  if (supabase) {
    const { data } = await supabase.from('drivers').select('*').order('name');
    drivers = data || [];
  } else {
    drivers = [
      { name: 'João Silva', cnh: '01234567890', phone: '(31) 99999-1111', cooperative: 'CoopTrans' },
      { name: 'Pedro Santos', cnh: '09876543210', phone: '(31) 99999-2222', cooperative: 'CoopTrans' },
    ];
  }

  const tbody = document.getElementById('motoristasTable');
  tbody.innerHTML = drivers.map(m => `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-sm font-medium">${m.name}</td>
      <td class="px-4 py-3 text-sm font-mono text-xs">${m.cnh}</td>
      <td class="px-4 py-3 text-sm">${m.phone || '-'}</td>
      <td class="px-4 py-3 text-sm">${m.cooperative || '-'}</td>
      <td class="px-4 py-3 text-sm"><span class="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-medium">Ativo</span></td>
    </tr>
  `).join('');
}

// ============ PDF ============
function exportPDF(tipo = 'agenda') {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFillColor(5, 150, 105);
  doc.rect(0, 0, 210, 25, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('🚌 BORA LÁ - EXCURSÕES', 14, 16);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Semed - Nova Lima/MG', 196, 16, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');

  if (tipo === 'agenda') {
    doc.text('Agenda Mensal de Viagens', 14, 40);
    doc.autoTable({
      startY: 45,
      head: [['Data', 'Hora', 'Destino', 'Cidade', 'Alunos', 'Status']],
      body: agenda.map(a => [
        new Date(a.trip_date + 'T00:00').toLocaleDateString('pt-BR'),
        a.departure_time, a.destination, a.city || '-', a.students_count, statusLabel(a.status)
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [5, 150, 105] }
    });
  }

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')} - Página ${i} de ${pages}`, 14, 290);
  }

  doc.save(`bora-la-${tipo}-${Date.now()}.pdf`);
  toast('📄 PDF gerado com sucesso!');
}

// ============ TOAST ============
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

// ============ SERVICE WORKER (PWA) ============
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(e => console.log('SW:', e));
}
