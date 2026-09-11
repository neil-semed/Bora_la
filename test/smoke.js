const { chromium } = require('playwright');

const BASE = 'http://localhost:8877';
const ROLES = [
  { email: 'admin@teste.com', role: 'admin' },
  { email: 'escola@teste.com', role: 'escola' },
  { email: 'pedagogia@teste.com', role: 'pedagogia' },
  { email: 'motorista@teste.com', role: 'motorista' },
];

// Um banco vazio de verdade não teria nem escola cadastrada, mas o app real do
// usuário já tem escolas/veículos/motoristas cadastrados - semeamos isso aqui pra
// simular um ambiente de produção de verdade (senão o wizard cai sempre em
// "Outra (não cadastrada)" por falta de opção, o que não reflete o uso real).
// Também semeamos os "profiles" com o papel certo pra cada e-mail de teste,
// senão o 1º login de cada um cria um perfil novo com papel padrão "escola" -
// o que faria os 4 logins de teste (admin/escola/pedagogia/motorista) virarem
// todos "escola" na prática, mascarando qualquer teste específico de papel
// (é exatamente assim que uma conta real ganha seu papel certo: o admin ajusta
// profiles.role/school_id/driver_id depois do primeiro login).
function fakeUserId(email) { return 'u_' + email.replace(/[^a-zA-Z0-9]/g, ''); }
const SEED_STORE = {
  profiles: [
    { id: fakeUserId('admin@teste.com'), email: 'admin@teste.com', role: 'admin', full_name: 'Admin Teste' },
    { id: fakeUserId('escola@teste.com'), email: 'escola@teste.com', role: 'escola', school_id: 's1', full_name: 'Escola Teste' },
    { id: fakeUserId('pedagogia@teste.com'), email: 'pedagogia@teste.com', role: 'pedagogia', full_name: 'Pedagogia Teste' },
    { id: fakeUserId('motorista@teste.com'), email: 'motorista@teste.com', role: 'motorista', driver_id: 'd1', full_name: 'Motorista Teste' },
  ],
  schools: [{ id: 's1', name: 'EMEF Prof. João Silva' }],
  vehicles: [{ id: 'v1', plate: 'ABC-1234', type: 'micro-onibus', capacity: 32, cooperative: 'CoopTrans', active: true }],
  drivers: [{ id: 'd1', name: 'João Silva', cnh: '123', phone: '31999990000', cooperative: 'CoopTrans', active: true }],
  excursions: [],
};

let failures = 0;

function fail(msg) {
  failures++;
  console.log('❌ FAIL:', msg);
}
function ok(msg) {
  console.log('✅', msg);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  for (const { email, role } of ROLES) {
    const page = await browser.newPage();

    // O sandbox de testes deste ambiente bloqueia CDNs externas (tailwind/lucide/jspdf/supabase-js).
    // Isso não acontece no navegador real do usuário final, então aqui simulamos (stub) essas libs
    // só para poder validar a LÓGICA da aplicação de ponta a ponta.
    await page.route('**cdn.tailwindcss.com**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* tailwind stub */' }));
    await page.route('**unpkg.com/lucide@latest**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons:function(){}};' }));
    // Store e sessão "de mentira" ficam em localStorage (não em variável JS solta) porque
    // agora o login navega de fato para app.html (outra página) — localStorage é o que
    // sobrevive a essa navegação, assim como o Supabase de verdade persiste sessão/dados
    // entre páginas.
    await page.route('**cdn.jsdelivr.net/npm/@supabase/supabase-js@2**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: `
      class FakeQuery {
        constructor(table) { this.table = table; this._op='select'; this._filters=[]; this._single=false; this._payload=null; this._order=null; }
        select() { return this; }
        insert(rows) { this._op='insert'; this._payload=rows; return this; }
        update(patch) { this._op='update'; this._payload=patch; return this; }
        delete() { this._op='delete'; return this; }
        eq(f,v) { this._filters.push([f,v]); return this; }
        order(f) { this._order=f; return this; }
        single() { this._single=true; return this; }
        then(resolve, reject) {
          try {
            const store = JSON.parse(localStorage.getItem('__fakeStore') || '{}');
            let rows = store[this.table] || (store[this.table]=[]);
            if (this._op==='insert') {
              const arr = Array.isArray(this._payload) ? this._payload : [this._payload];
              const ins = arr.map(r => ({ id: r.id || (this.table+'_'+Math.random().toString(36).slice(2)), ...r }));
              rows.push(...ins);
              localStorage.setItem('__fakeStore', JSON.stringify(store));
              resolve({ data: this._single ? ins[0] : ins, error: null }); return;
            }
            if (this._op==='update') {
              let m = rows; this._filters.forEach(([f,v]) => { m = m.filter(r=>r[f]===v); });
              m.forEach(r => Object.assign(r, this._payload));
              localStorage.setItem('__fakeStore', JSON.stringify(store));
              resolve({ data: m, error: null }); return;
            }
            if (this._op==='delete') {
              let keep = rows; let removed = rows;
              this._filters.forEach(([f,v]) => { keep = keep.filter(r=>r[f]!==v); });
              removed = rows.filter(r => !keep.includes(r));
              store[this.table] = keep;
              localStorage.setItem('__fakeStore', JSON.stringify(store));
              resolve({ data: removed, error: null }); return;
            }
            let result = rows.slice();
            this._filters.forEach(([f,v]) => { result = result.filter(r=>r[f]===v); });
            if (this._order) result = result.slice().sort((a,b)=> (a[this._order]>b[this._order]?1:-1));
            resolve(this._single ? { data: result[0]||null, error: null } : { data: result, error: null });
          } catch(e) { reject(e); }
        }
      }
      window.supabase = { createClient: function() { return {
        auth: {
          getSession: async () => {
            const raw = localStorage.getItem('__fakeSession');
            return { data: { session: raw ? JSON.parse(raw) : null } };
          },
          signInWithPassword: async ({ email }) => {
            const user = { id: 'u_' + email.replace(/[^a-zA-Z0-9]/g,''), email };
            localStorage.setItem('__fakeSession', JSON.stringify({ user }));
            return { data: { user }, error: null };
          },
          signOut: async () => { localStorage.removeItem('__fakeSession'); return { error: null }; },
        },
        from: (table) => new FakeQuery(table),
      }; } };
    ` }));
    await page.route('**cdnjs.cloudflare.com/ajax/libs/jspdf/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.jspdf={jsPDF:function(){this.setFillColor=()=>{};this.rect=()=>{};this.setTextColor=()=>{};this.setFontSize=()=>{};this.setFont=()=>{};this.text=()=>{};this.autoTable=()=>{};this.internal={getNumberOfPages:()=>1};this.setPage=()=>{};this.save=()=>{};}};' }));
    await page.route('**cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* autotable stub */' }));
    await page.route('**cdn.jsdelivr.net/npm/chart.js**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){return{destroy:function(){}};};' }));
    await page.route('**cdn.jsdelivr.net/npm/xlsx**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX={utils:{json_to_sheet:function(){return{};},book_new:function(){return{};},book_append_sheet:function(){}},writeFile:function(){}};' }));

    // Semeia o "banco" (localStorage) antes de qualquer script da página rodar,
    // só se ainda não existir (assim cada perfil da lista reaproveita o mesmo
    // "banco" semeado, como aconteceria numa instalação real já em uso).
    await page.addInitScript((seed) => {
      if (!localStorage.getItem('__fakeStore')) localStorage.setItem('__fakeStore', JSON.stringify(seed));
    }, SEED_STORE);

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });

    // login (agora é uma página separada: login em index.html navega de verdade para app.html)
    await page.fill('#loginEmail', email);
    await page.fill('#loginPassword', 'qualquer123');
    await page.click('#loginForm button[type=submit]');
    await page.waitForURL('**/app.html', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle');

    const onAppPage = page.url().includes('app.html');
    if (!onAppPage) fail(`[${role}] não navegou para app.html após login (url: ${page.url()})`);
    else ok(`[${role}] login OK, navegou para app.html`);

    const appVisible = await page.isVisible('#appScreen');
    if (!appVisible) fail(`[${role}] appScreen não ficou visível após login`);
    else ok(`[${role}] entrou no app`);

    const roleLabel = await page.textContent('#userRole');
    ok(`[${role}] rótulo de perfil exibido: ${roleLabel.trim()}`);

    // check which nav links are visible
    const navState = await page.$$eval('.sidebar-link', (links) =>
      links.map((l) => ({ screen: l.dataset.screen, hidden: l.hidden }))
    );
    console.log(`   [${role}] nav:`, JSON.stringify(navState));

    // dashboard stats present and numeric
    const statHoje = await page.textContent('#statHoje');
    if (isNaN(parseInt(statHoje))) fail(`[${role}] statHoje não é número: ${statHoje}`);

    // click through every visible nav screen
    for (const item of navState) {
      if (item.hidden) continue;
      await page.click(`.sidebar-link[data-screen="${item.screen}"]`);
      await page.waitForTimeout(200);
      const secVisible = await page.isVisible('#screen-' + item.screen);
      if (!secVisible) fail(`[${role}] tela ${item.screen} não ficou visível ao clicar`);
      else ok(`[${role}] navegou para ${item.screen}`);
    }

    // if solicitacao is accessible, run through the wizard
    const canSolicitar = navState.some((n) => n.screen === 'solicitacao' && !n.hidden);
    if (canSolicitar) {
      await page.click('.sidebar-link[data-screen="solicitacao"]');
      await page.waitForTimeout(150);
      // Escola já tem a própria unidade fixada, então o wizard pula direto pro passo 2
      // (Destino) - só admin/outros perfis com escolha de unidade passam pelo passo 1.
      if (role !== 'escola') await page.click('#btnNext'); // step1 -> 2
      await page.fill('#wDestino', 'Parque de Testes');
      await page.fill('#wCidade', 'Belo Horizonte');
      await page.click('#btnNext'); // step2 -> 3
      await page.fill('#wData', '2026-12-10');
      await page.fill('#wHora', '08:00');
      await page.click('#btnNext'); // step3 -> 4
      await page.fill('#wAlunos', '40');
      await page.fill('#wAcompanhantes', '4');
      await page.selectOption('#wPublicoAlvo', 'fundamental_iniciais');
      await page.click('#btnNext'); // step4 -> 5
      const resumo = await page.textContent('#resumoSolicitacao');
      if (!resumo.includes('Parque de Testes')) fail(`[${role}] resumo do wizard não contém o destino informado`);
      const sugestao = await page.textContent('#sugestaoVeiculos');
      if (!sugestao.includes('ATF')) fail(`[${role}] aviso de ATF não apareceu para cidade fora de Nova Lima`);
      await page.click('#btnNext'); // enviar
      await page.waitForTimeout(300);
      const onAgenda = await page.isVisible('#screen-agenda');
      if (!onAgenda) fail(`[${role}] não voltou para a agenda após enviar solicitação`);
      const agendaTxt = await page.textContent('#agendaTable');
      if (!agendaTxt.includes('Parque de Testes')) fail(`[${role}] nova solicitação não apareceu na agenda`);
      else ok(`[${role}] wizard completo: solicitação criada e visível na agenda`);
    }

    // relatorios (PDF) if accessible
    const canReport = navState.some((n) => n.screen === 'relatorios' && !n.hidden);
    if (canReport) {
      await page.click('.sidebar-link[data-screen="relatorios"]');
      await page.waitForTimeout(150);
      await page.click('button:has-text("Exportar em PDF")');
      await page.waitForTimeout(150);
      ok(`[${role}] clique em exportar PDF não gerou erro`);
      await page.click('button:has-text("Exportar em Excel")');
      await page.waitForTimeout(150);
      ok(`[${role}] clique em exportar Excel não gerou erro`);
    }

    if (role === 'admin') {
      await page.screenshot({ path: '/tmp/borala/test/screenshot-admin-dashboard.png' });
    }

    // logout (deve navegar de volta para index.html de verdade)
    await page.click('button:has-text("Sair")');
    await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
    const onLoginPage = page.url().includes('index.html') || page.url().endsWith('/');
    const backToLogin = onLoginPage && (await page.isVisible('#loginScreen'));
    if (!backToLogin) fail(`[${role}] logout não retornou à página de login (url: ${page.url()})`);
    else ok(`[${role}] logout OK, voltou para index.html`);

    if (consoleErrors.length) {
      fail(`[${role}] erros no console: ${JSON.stringify(consoleErrors)}`);
    } else {
      ok(`[${role}] nenhum erro de console`);
    }

    await page.close();
  }

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);
})();
