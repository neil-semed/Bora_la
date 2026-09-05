// ============================================================
// BORA LÁ - EXCURSÕES | Lógica principal
// ============================================================

let supabase = null;
let currentUser = null;
let wizardStep = 1;
let agenda = [];

// ============ DADOS DEMO ============
const DEMO_VEHICLES = [
  { id: 1, placa: 'ABC-1234', tipo: 'Micro-ônibus', capacidade: 32, cooperativa: 'CoopTrans', motorista: 'João Silva' },
  { id: 2, placa: 'DEF-5678', tipo: 'Van', capacidade: 15, cooperativa: 'CoopTrans', motorista: 'Pedro Santos' },
  { id: 3, placa: 'GHI-9012', tipo: 'Micro-ônibus', capacidade: 32, cooperativa: 'TransNova', motorista: 'Carlos Oliveira' },
  { id: 4, placa: 'JKL-3456', tipo: 'Van', capacidade: 15, cooperativa: 'TransNova', motorista: 'Lucas Ferreira' },
  { id: 5, placa: 'MNO-7890', tipo: 'Ônibus', capacidade: 46, cooperativa: 'Escolar MG', motorista: 'Roberto Lima' },
];

const DEMO_MOTORISTAS = [
  { nome: 'João Silva', cnh: '01234567890', telefone: '(31) 99999-1111', cooperativa: 'CoopTrans', viagens: 47 },
  { nome: 'Pedro Santos', cnh: '09876543210', telefone: '(31) 99999-2222', cooperativa: 'CoopTrans', viagens: 32 },
  { nome: 'Carlos Oliveira', cnh: '04567891230', telefone: '(31) 99999-3333', cooperativa: 'TransNova', viagens: 58 },
  { nome: 'Lucas Ferreira', cnh: '07891234560', telefone: '(31) 99999-4444', cooperativa: 'TransNova', viagens: 21 },
  { nome: 'Roberto Lima', cnh: '03216549870', telefone: '(31) 99999-5555', cooperativa: 'Escolar MG', viagens: 73 },
];

const DEMO_AGENDA = [
  { id: 1, data: '2026-09-06', hora: '08:00', escola: 'EM Padre Eustáquio', destino: 'Museu da Pampulha', cidade: 'BH/MG', alunos: 28, veiculo: 'Micro-ônibus ABC-1234', status: 'approved' },
  { id: 2, data: '2026-09-06', hora: '09:30', escola: 'EM São Cosme', destino: 'Parque Municipal', cidade: 'BH/MG', alunos: 14, veiculo: 'Van DEF-5678', status: 'transit' },
  { id: 3, data: '2026-09-07', hora: '07:30', escola: 'EM Belvedere', destino: 'Zoológico', cidade: 'BH/MG', alunos: 30, veiculo: 'Micro-ônibus GHI-9012', status: 'pending' },
  { id: 4, data: '2026-09-08', hora: '13:00', escola: 'EM Campo Belo', destino: 'Serra do Curral', cidade: 'BH/MG', alunos: 12, veiculo: 'Van JKL-3456', status: 'pending' },
  { id: 5, data: '2026-09-10', hora: '08:00', escola: 'EM Padre Eustáquio', destino: 'Circuito da Liberdade', cidade: 'BH/MG', alunos: 42, veiculo: 'Ônibus MNO-7890', status: 'approved' },
];

// ============ INICIALIZAÇÃO ============
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initSupabase();
  loadDemoData();

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
    toast('✅ Supabase configurado!');
  }
}

// ============ LOGIN ============
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  // Tenta Supabase real se configurado
  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast('❌ ' + error.message, true);
      return;
    }
    currentUser = data.user;
  }

  // Modo demo: qualquer credencial funciona
  if (!currentUser) {
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
  document.getElementById('userRole').textContent = currentUser.role.toUpperCase();
  document.getElementById('userInfo').textContent = currentUser.email;
  document.getElementById('userAvatar').textContent = name[0].toUpperCase();

  renderDashboard();
  renderAgenda();
  renderVeiculos();
  renderMotoristas();
}

function logout() {
  if (supabase) supabase.auth.signOut();
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
function loadDemoData() {
  agenda = [...DEMO_AGENDA];
}

function renderDashboard() {
  const hoje = new Date().toISOString().split('T')[0];
  const viagensHoje = agenda.filter(a => a.data === hoje).length;
  const pendentes = agenda.filter(a => a.status === 'pending').length;
  const aprovadas = agenda.filter(a => a.status === 'approved').length;
  const alunos = agenda.reduce((s, a) => s + a.alunos, 0);

  document.getElementById('statHoje').textContent = viagensHoje;
  document.getElementById('statPendentes').textContent = pendentes;
  document.getElementById('statAprovadas').textContent = aprovadas;
  document.getElementById('statAlunos').textContent = alunos;

  const proximas = agenda
    .filter(a => a.data >= hoje)
    .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora))
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
          <span class="text-xs text-emerald-700 font-semibold">${new Date(a.data + 'T00:00').toLocaleDateString('pt-BR', { month: 'short' })}</span>
          <span class="text-lg font-bold text-emerald-800">${new Date(a.data + 'T00:00').getDate()}</span>
        </div>
        <div>
          <div class="font-medium text-slate-800">${a.escola} → ${a.destino}</div>
          <div class="text-xs text-slate-500">${a.hora} • ${a.alunos} alunos • ${a.veiculo}</div>
        </div>
      </div>
      <span class="status-${a.status} px-2 py-1 rounded text-xs font-medium">${statusLabel(a.status)}</span>
    </div>
  `).join('');
}

function statusLabel(s) {
  return { pending: 'Pendente', approved: 'Aprovada', transit: 'Em trânsito', rejected: 'Recusada' }[s] || s;
}

// ============ AGENDA ============
function renderAgenda() {
  const filtered = filterAgenda();
  const tbody = document.getElementById('agendaTable');

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-500 text-sm">Nenhuma viagem encontrada</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)).map(a => `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-sm">
        <div class="font-medium">${new Date(a.data + 'T00:00').toLocaleDateString('pt-BR')}</div>
        <div class="text-xs text-slate-500">${a.hora}</div>
      </td>
      <td class="px-4 py-3 text-sm">${a.escola}</td>
      <td class="px-4 py-3 text-sm">
        <div>${a.destino}</div>
        <div class="text-xs text-slate-500">${a.cidade}</div>
      </td>
      <td class="px-4 py-3 text-sm font-medium">${a.alunos}</td>
      <td class="px-4 py-3 text-sm text-xs">${a.veiculo}</td>
      <td class="px-4 py-3"><span class="status-${a.status} px-2 py-1 rounded text-xs font-medium">${statusLabel(a.status)}</span></td>
      <td class="px-4 py-3">
        <button onclick="aprovarViagem(${a.id})" class="text-emerald-600 hover:text-emerald-800 text-xs font-medium">Aprovar</button>
      </td>
    </tr>
  `).join('');
}

function filterAgenda() {
  const data = document.getElementById('filtroData').value;
  const status = document.getElementById('filtroStatus').value;
  const escola = document.getElementById('filtroEscola').value.toLowerCase();

  return agenda.filter(a => {
    if (data && a.data !== data) return false;
    if (status && a.status !== status) return false;
    if (escola && !a.escola.toLowerCase().includes(escola)) return false;
    return true;
  });
}

function filtrarAgenda() { renderAgenda(); }

function aprovarViagem(id) {
  const v = agenda.find(a => a.id === id);
  if (v) {
    v.status = 'approved';
    renderAgenda();
    renderDashboard();
    toast('✅ Viagem aprovada!');
  }
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

  // Sugestão automática de veículos
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
    id: Date.now(),
    data: document.getElementById('wData').value,
    hora: document.getElementById('wHora').value,
    escola: document.getElementById('wEscola').value,
    destino: document.getElementById('wDestino').value,
    cidade: document.getElementById('wCidade').value,
    alunos: parseInt(document.getElementById('wAlunos').value) || 0,
    veiculo: 'A definir',
    status: 'pending'
  };

  // Tenta salvar no Supabase
  if (supabase) {
    const { error } = await supabase.from('excursions').insert([nova]);
    if (error) console.warn('Erro Supabase:', error);
  }

  agenda.push(nova);
  toast('✅ Solicitação enviada com sucesso!');

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

  renderDashboard();
  renderAgenda();
  showScreen('agenda');
}

// ============ VEÍCULOS ============
function renderVeiculos() {
  const grid = document.getElementById('veiculosGrid');
  grid.innerHTML = DEMO_VEHICLES.map(v => `
    <div class="bg-white rounded-xl border border-slate-200 p-5 card-hover">
      <div class="flex items-start justify-between mb-3">
        <div class="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center">
          <i data-lucide="bus" class="w-6 h-6 text-emerald-600"></i>
        </div>
        <span class="text-xs bg-slate-100 px-2 py-1 rounded font-mono">${v.placa}</span>
      </div>
      <h3 class="font-semibold text-slate-800">${v.tipo}</h3>
      <p class="text-sm text-slate-500 mb-3">${v.cooperativa}</p>
      <div class="flex items-center justify-between text-sm border-t border-slate-100 pt-3">
        <span class="text-slate-600"><i data-lucide="users" class="w-4 h-4 inline"></i> ${v.capacidade} lugares</span>
        <span class="text-slate-500 text-xs">${v.motorista}</span>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

// ============ MOTORISTAS ============
function renderMotoristas() {
  const tbody = document.getElementById('motoristasTable');
  tbody.innerHTML = DEMO_MOTORISTAS.map(m => `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-sm font-medium">${m.nome}</td>
      <td class="px-4 py-3 text-sm font-mono text-xs">${m.cnh}</td>
      <td class="px-4 py-3 text-sm">${m.telefone}</td>
      <td class="px-4 py-3 text-sm">${m.cooperativa}</td>
      <td class="px-4 py-3 text-sm"><span class="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-medium">${m.viagens} viagens</span></td>
    </tr>
  `).join('');
}

// ============ PDF ============
function exportPDF(tipo = 'agenda') {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Cabeçalho
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
      head: [['Data', 'Hora', 'Escola', 'Destino', 'Alunos', 'Veículo', 'Status']],
      body: agenda.map(a => [
        new Date(a.data + 'T00:00').toLocaleDateString('pt-BR'),
        a.hora, a.escola, a.destino, a.alunos, a.veiculo, statusLabel(a.status)
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [5, 150, 105] }
    });
  } else if (tipo === 'passageiros') {
    doc.text('Lista de Passageiros', 14, 40);
    doc.autoTable({
      startY: 45,
      head: [['Escola', 'Destino', 'Data', 'Alunos', 'Veículo']],
      body: agenda.map(a => [a.escola, a.destino, new Date(a.data + 'T00:00').toLocaleDateString('pt-BR'), a.alunos, a.veiculo]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [5, 150, 105] }
    });
  } else if (tipo === 'motorista') {
    doc.text('Ficha do Motorista', 14, 40);
    const m = DEMO_MOTORISTAS[0];
    doc.autoTable({
      startY: 45,
      body: [
        ['Nome', m.nome], ['CNH', m.cnh], ['Telefone', m.telefone],
        ['Cooperativa', m.cooperativa], ['Total de Viagens', m.viagens]
      ],
      styles: { fontSize: 10 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } }
    });
  } else if (tipo === 'atf') {
    doc.text('ATF - Autorização de Trânsito de Frete', 14, 40);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Documento oficial para viagens fora do município de Nova Lima/MG', 14, 50);
    doc.autoTable({
      startY: 60,
      head: [['Data', 'Escola', 'Destino', 'Cidade', 'Alunos', 'Veículo']],
      body: agenda.filter(a => !a.cidade.toLowerCase().includes('nova lima')).map(a => [
        new Date(a.data + 'T00:00').toLocaleDateString('pt-BR'),
        a.escola, a.destino, a.cidade, a.alunos, a.veiculo
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [5, 150, 105] }
    });
  }

  // Rodapé
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