// Testa a lateral (menu) num viewport de celular: por padrão ela deve ficar escondida
// (fora da tela), sem ocupar espaço nem ser "puxável" por scroll horizontal; um botão ☰
// abre ela como uma gaveta por cima do conteúdo, com um fundo escurecido que fecha ao
// tocar fora, e navegar pra uma tela nova também fecha a gaveta sozinha. No tablet/
// desktop (viewport largo), continua exatamente como sempre foi: sempre visível do lado.
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

  // ---- 1) VIEWPORT DE CELULAR (Android comum, 390x844) ----
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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

  await loginAs(page, 'admin@teste.com');

  const sidebarBoxFechado = await page.locator('#sidebar').boundingBox();
  if (!sidebarBoxFechado || sidebarBoxFechado.x <= -50) ok('no celular, a lateral começa fora da tela (fechada por padrão)');
  else fail('a lateral não começou fora da tela no celular: ' + JSON.stringify(sidebarBoxFechado));

  const bodyScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  if (bodyScrollWidth <= viewportWidth + 2) ok('página não tem scroll horizontal no celular (largura do conteúdo bate com a da tela)');
  else fail(`página tem scroll horizontal no celular: scrollWidth=${bodyScrollWidth} vs viewport=${viewportWidth}`);

  // Simula "tocar, segurar e arrastar" pra esquerda -> não deve revelar a lateral
  await page.mouse.move(300, 400);
  await page.mouse.down();
  await page.mouse.move(50, 400, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const sidebarBoxAposArrastar = await page.locator('#sidebar').boundingBox();
  if (!sidebarBoxAposArrastar || sidebarBoxAposArrastar.x <= -50) ok('tocar e arrastar na tela não revela a lateral (ela continua fora da tela)');
  else fail('arrastar na tela revelou a lateral: ' + JSON.stringify(sidebarBoxAposArrastar));

  // Abre pelo botão ☰
  await page.click('header button[aria-label="Abrir menu"]');
  await page.waitForTimeout(250);
  const sidebarBoxAberto = await page.locator('#sidebar').boundingBox();
  if (sidebarBoxAberto && sidebarBoxAberto.x > -10 && sidebarBoxAberto.x < 10) ok('botão ☰ abre a lateral como gaveta, encostada na esquerda');
  else fail('lateral não abriu corretamente pelo botão ☰: ' + JSON.stringify(sidebarBoxAberto));

  const overlayVisivel = await page.isVisible('#sidebarOverlay');
  if (overlayVisivel) ok('fundo escurecido (overlay) aparece atrás da gaveta aberta');
  else fail('overlay não apareceu com a gaveta aberta');

  // Clicar no overlay fecha a gaveta
  await page.click('#sidebarOverlay', { position: { x: 350, y: 400 } });
  await page.waitForTimeout(250);
  const sidebarBoxFechadoDeNovo = await page.locator('#sidebar').boundingBox();
  if (!sidebarBoxFechadoDeNovo || sidebarBoxFechadoDeNovo.x <= -50) ok('tocar no fundo escurecido fecha a gaveta de novo');
  else fail('overlay não fechou a gaveta: ' + JSON.stringify(sidebarBoxFechadoDeNovo));

  // Abre de novo e clica num item do menu -> deve navegar E fechar a gaveta sozinha
  await page.click('header button[aria-label="Abrir menu"]');
  await page.waitForTimeout(200);
  await page.click('.sidebar-link[data-screen="agenda"]');
  await page.waitForTimeout(250);
  const telaAgendaVisivel = await page.isVisible('#screen-agenda');
  const sidebarBoxAposNavegar = await page.locator('#sidebar').boundingBox();
  if (telaAgendaVisivel && (!sidebarBoxAposNavegar || sidebarBoxAposNavegar.x <= -50)) {
    ok('clicar num item do menu navega pra tela certa E fecha a gaveta sozinha');
  } else {
    fail('gaveta não fechou sozinha ao navegar, ou não navegou certo: tela visível=' + telaAgendaVisivel + ', box=' + JSON.stringify(sidebarBoxAposNavegar));
  }

  if (errors.length) fail('erros de console/página (celular): ' + JSON.stringify(errors));
  else ok('nenhum erro de console/página no viewport de celular');

  await page.close();

  // ---- 2) VIEWPORT DE DESKTOP (1280x800) - lateral continua sempre visível, como antes ----
  const pageD = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageD.route('**cdn.tailwindcss.com**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await pageD.route('**unpkg.com/lucide@latest**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons:function(){}};' }));
  await pageD.route('**cdn.jsdelivr.net/npm/@supabase/supabase-js@2**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await pageD.route('**cdnjs.cloudflare.com/ajax/libs/jspdf/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await pageD.route('**cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await pageD.route('**cdn.jsdelivr.net/npm/chart.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){return{destroy:function(){}};};' }));
  await pageD.route('**cdn.jsdelivr.net/npm/xlsx**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX={utils:{json_to_sheet:function(){return{};},book_new:function(){return{};},book_append_sheet:function(){}},writeFile:function(){}};' }));
  await loginAs(pageD, 'admin@teste.com');
  const sidebarBoxDesktop = await pageD.locator('#sidebar').boundingBox();
  const menuBtnVisivelDesktop = await pageD.isVisible('header button[aria-label="Abrir menu"]');
  if (sidebarBoxDesktop && sidebarBoxDesktop.x >= -1 && sidebarBoxDesktop.x < 5 && !menuBtnVisivelDesktop) {
    ok('no desktop, a lateral continua sempre visível do lado e o botão ☰ fica escondido (layout de antes, intacto)');
  } else {
    fail('layout de desktop mudou indevidamente: box=' + JSON.stringify(sidebarBoxDesktop) + ', botão ☰ visível=' + menuBtnVisivelDesktop);
  }
  await pageD.close();

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES (LATERAL NO CELULAR) PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);
})();
