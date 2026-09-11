// Testa o app como se o Supabase estivesse de fato configurado (agora que a URL/chave
// vêm embutidas por padrão em app.js), usando um Supabase-JS "de mentira" (fake) que
// persiste em localStorage — assim como a sessão/dados reais do Supabase sobrevivem a uma
// troca de página, já que login (index.html) e app (app.html) agora são páginas separadas.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8877';
let failures = 0;
function fail(msg) { failures++; console.log('❌ FAIL:', msg); }
function ok(msg) { console.log('✅', msg); }

const FAKE_SUPABASE_JS = `
class FakeQuery {
  constructor(table) { this.table = table; this._op = 'select'; this._filters = []; this._single = false; this._payload = null; this._order = null; }
  select() { return this; }
  insert(rows) { this._op = 'insert'; this._payload = rows; return this; }
  update(patch) { this._op = 'update'; this._payload = patch; return this; }
  delete() { this._op = 'delete'; return this; }
  eq(field, val) { this._filters.push([field, val]); return this; }
  order(field) { this._order = field; return this; }
  single() { this._single = true; return this; }
  then(resolve, reject) {
    try {
      const store = JSON.parse(localStorage.getItem('__fakeStore') || '{}');
      let rows = store[this.table] || (store[this.table] = []);
      if (this._op === 'insert') {
        const arr = Array.isArray(this._payload) ? this._payload : [this._payload];
        const inserted = arr.map((r) => ({ id: r.id || (this.table + '_' + Math.random().toString(36).slice(2)), ...r }));
        rows.push(...inserted);
        localStorage.setItem('__fakeStore', JSON.stringify(store));
        resolve({ data: this._single ? inserted[0] : inserted, error: null });
        return;
      }
      if (this._op === 'update') {
        let matched = rows;
        this._filters.forEach(([f, v]) => { matched = matched.filter((r) => r[f] === v); });
        matched.forEach((r) => Object.assign(r, this._payload));
        localStorage.setItem('__fakeStore', JSON.stringify(store));
        resolve({ data: matched, error: null });
        return;
      }
      if (this._op === 'delete') {
        let keep = rows;
        this._filters.forEach(([f, v]) => { keep = keep.filter((r) => r[f] !== v); });
        const removed = rows.filter((r) => !keep.includes(r));
        store[this.table] = keep;
        localStorage.setItem('__fakeStore', JSON.stringify(store));
        resolve({ data: removed, error: null });
        return;
      }
      let result = rows.slice();
      this._filters.forEach(([f, v]) => { result = result.filter((r) => r[f] === v); });
      if (this._order) result = result.slice().sort((a, b) => (a[this._order] > b[this._order] ? 1 : -1));
      resolve(this._single ? { data: result[0] || null, error: null } : { data: result, error: null });
    } catch (e) { reject(e); }
  }
}
window.supabase = {
  createClient: function () {
    return {
      auth: {
        getSession: async () => {
          const raw = localStorage.getItem('__fakeSession');
          return { data: { session: raw ? JSON.parse(raw) : null } };
        },
        signInWithPassword: async ({ email }) => {
          const user = { id: 'u_' + email.replace(/[^a-zA-Z0-9]/g, ''), email };
          localStorage.setItem('__fakeSession', JSON.stringify({ user }));
          return { data: { user }, error: null };
        },
        signOut: async () => { localStorage.removeItem('__fakeSession'); return { error: null }; },
      },
      from: (table) => new FakeQuery(table),
    };
  },
};
`;

const SEED_STORE = {
  profiles: [],
  schools: [{ id: 's1', name: 'EMEF Prof. João Silva' }],
  vehicles: [{ id: 'v1', plate: 'ABC-1234', type: 'micro-onibus', capacity: 32, cooperative: 'CoopTrans', active: true }],
  drivers: [{ id: 'd1', name: 'João Silva', cnh: '123', phone: '31999990000', cooperative: 'CoopTrans', active: true }],
  excursions: [],
};

async function fakeStoreLen(page, table) {
  return page.evaluate((t) => (JSON.parse(localStorage.getItem('__fakeStore') || '{}')[t] || []).length, table);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.route('**cdn.tailwindcss.com**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**unpkg.com/lucide@latest**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons:function(){}};' }));
  await page.route('**cdn.jsdelivr.net/npm/@supabase/supabase-js@2**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_SUPABASE_JS }));
  await page.route('**cdnjs.cloudflare.com/ajax/libs/jspdf/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**cdn.jsdelivr.net/npm/chart.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){return{destroy:function(){}};};' }));
  await page.route('**cdn.jsdelivr.net/npm/xlsx**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX={utils:{json_to_sheet:function(){return{};},book_new:function(){return{};},book_append_sheet:function(){}},writeFile:function(){}};' }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // Semeia o "banco" (localStorage) antes de qualquer script da página rodar.
  await page.addInitScript((seed) => {
    if (!localStorage.getItem('__fakeStore')) localStorage.setItem('__fakeStore', JSON.stringify(seed));
  }, SEED_STORE);

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });

  // primeiro login: deve criar profile com role padrão 'escola', e navegar para app.html de verdade
  await page.fill('#loginEmail', 'novapessoa@teste.com');
  await page.fill('#loginPassword', 'x');
  await page.click('#loginForm button[type=submit]');
  await page.waitForURL('**/app.html', { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState('networkidle');

  if (!page.url().includes('app.html')) fail('não navegou para app.html no primeiro login via "Supabase" (fake) — url: ' + page.url());
  else ok('primeiro login (via Supabase fake) navegou para app.html');

  if (!(await page.isVisible('#appScreen'))) fail('appScreen não abriu no primeiro login via "Supabase" (fake)');
  else ok('primeiro login (via Supabase fake) entrou no app');

  const roleTxt = await page.textContent('#userRole');
  if (!roleTxt.toLowerCase().includes('escola')) fail('papel padrão não foi "escola" no primeiro login: ' + roleTxt);
  else ok('novo usuário recebeu o papel padrão "escola" automaticamente (via profiles.insert)');

  const profilesAfterFirstLogin = await fakeStoreLen(page, 'profiles');
  if (profilesAfterFirstLogin !== 1) fail('esperava 1 linha em profiles após o primeiro login, achou ' + profilesAfterFirstLogin);
  else ok('linha criada em profiles no primeiro login');

  // logout: deve navegar de volta para index.html de verdade
  await page.click('button:has-text("Sair")');
  await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState('networkidle');
  if (!page.url().includes('index.html') && !page.url().endsWith('/')) fail('logout não voltou para index.html — url: ' + page.url());
  else ok('logout navegou de volta para index.html');

  // simula o admin rodando "update profiles set role='admin'..." no SQL Editor
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('__fakeStore') || '{}');
    store.profiles[0].role = 'admin';
    localStorage.setItem('__fakeStore', JSON.stringify(store));
  });

  // segundo login: deve ler o profile já existente (agora admin), não recriar
  await page.fill('#loginEmail', 'novapessoa@teste.com');
  await page.fill('#loginPassword', 'x');
  await page.click('#loginForm button[type=submit]');
  await page.waitForURL('**/app.html', { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState('networkidle');

  const roleTxt2 = await page.textContent('#userRole');
  if (!roleTxt2.toLowerCase().includes('admin')) fail('após promover a "admin" na tabela profiles, o app não refletiu: ' + roleTxt2);
  else ok('segundo login refletiu o papel atualizado (admin) sem duplicar o profile');

  const profilesAfterSecondLogin = await fakeStoreLen(page, 'profiles');
  if (profilesAfterSecondLogin !== 1) fail('profiles duplicou no segundo login: ' + profilesAfterSecondLogin);
  else ok('nenhuma duplicação em profiles no segundo login');

  // navega e cria uma solicitação de verdade contra o "Supabase" (fake) para conferir insert em excursions
  await page.click('.sidebar-link[data-screen="solicitacao"]');
  await page.waitForTimeout(150);
  // Neste ponto o usuário já foi promovido a "admin" (acima), então o wizard começa no
  // passo 1 normal (escolha de unidade) - só o perfil "escola" pula direto pro passo 2.
  await page.click('#btnNext');
  await page.fill('#wDestino', 'Teste via Supabase');
  await page.fill('#wCidade', 'Nova Lima');
  await page.click('#btnNext');
  await page.fill('#wData', '2026-12-01');
  await page.fill('#wHora', '08:00');
  await page.click('#btnNext');
  await page.selectOption('#wPublicoAlvo', 'fundamental_iniciais');
  await page.click('#btnNext');
  await page.click('#btnNext');
  await page.waitForTimeout(300);
  const excursionsCount = await fakeStoreLen(page, 'excursions');
  if (excursionsCount !== 1) fail('excursions não recebeu o insert esperado: ' + excursionsCount);
  else ok('nova solicitação foi inserida via supabase.from(excursions).insert(...)');

  if (errors.length) fail('erros de console/página: ' + JSON.stringify(errors));
  else ok('nenhum erro de console/página em todo o fluxo');

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES (MODO SUPABASE) PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);
})();
