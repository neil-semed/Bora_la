// Testa os ajustes pedidos depois do esboço: (1) "Minhas Viagens" (motorista) não mostra
// mais o filtro de Situação, já que ela aparece no próprio cartão, mas o Admin continua
// vendo esse filtro normalmente; (2) o botão "Sair" da lateral ficou maior; (3) a tela de
// login mostra "Sistema de Excursões" e "Semed - Nova Lima" em duas linhas, centralizado.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8877';
let failures = 0;
function fail(msg) { failures++; console.log('❌ FAIL:', msg); }
function ok(msg) { console.log('✅', msg); }

async function loginAs(page, email) {
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.fill('#loginEmail', email);
  await page.fill('#loginPassword', 'x');
  await page.click('#loginForm button[type=submit]');
  await page.waitForURL('**/app.html', { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState('networkidle');
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.route('**cdn.tailwindcss.com**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**unpkg.com/lucide@latest**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons:function(){}};' }));
  await page.route('**cdn.jsdelivr.net/npm/@supabase/supabase-js@2**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**cdnjs.cloudflare.com/ajax/libs/jspdf/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**cdn.jsdelivr.net/npm/chart.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){return{destroy:function(){}};};' }));
  await page.route('**cdn.jsdelivr.net/npm/xlsx**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX={utils:{json_to_sheet:function(){return{};},book_new:function(){return{};},book_append_sheet:function(){}},writeFile:function(){}};' }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // ---- 1) Login: texto em duas linhas ----
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  const textoLogin = await page.locator('#loginScreen p').first().innerHTML();
  if (textoLogin.includes('Sistema de Excursões') && textoLogin.includes('<br') && textoLogin.includes('Semed - Nova Lima')) {
    ok('tela de login mostra "Sistema de Excursões" e "Semed - Nova Lima" em duas linhas');
  } else {
    fail('texto da tela de login não bateu com o esperado: ' + textoLogin);
  }

  // ---- 2) Motorista: filtro de Situação sumiu da tela "Minhas Viagens" ----
  await loginAs(page, 'motorista@teste.com');
  await page.click('.sidebar-link[data-screen="agenda"]');
  await page.waitForTimeout(150);
  const situacaoVisivelMotorista = await page.isVisible('#filtroSituacaoWrap');
  if (!situacaoVisivelMotorista) ok('motorista não vê mais o filtro de Situação em "Minhas Viagens" (já está no cartão)');
  else fail('filtro de Situação ainda aparece pro motorista');

  const botaoSairClasse = await page.getAttribute('button[onclick="logout()"]', 'class');
  if (botaoSairClasse.includes('text-base') && botaoSairClasse.includes('py-3')) {
    ok('botão "Sair" da lateral ficou maior (mais padding e fonte maior)');
  } else {
    fail('botão "Sair" não ficou maior como esperado: ' + botaoSairClasse);
  }
  await page.click('button[onclick="logout()"]');
  await page.waitForTimeout(200);

  // ---- 3) Admin: filtro de Situação continua aparecendo normalmente ----
  await loginAs(page, 'admin@teste.com');
  await page.click('.sidebar-link[data-screen="agenda"]');
  await page.waitForTimeout(150);
  const situacaoVisivelAdmin = await page.isVisible('#filtroSituacaoWrap');
  if (situacaoVisivelAdmin) ok('admin continua vendo o filtro de Situação normalmente na Agenda');
  else fail('filtro de Situação sumiu indevidamente pro admin');

  if (errors.length) fail('erros de console/página: ' + JSON.stringify(errors));
  else ok('nenhum erro de console/página em todo o fluxo');

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES (AJUSTES VISUAIS 2) PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);
})();
