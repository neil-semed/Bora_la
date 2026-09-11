// Testa a tela Agenda ("Minhas Viagens" pro motorista) num viewport de celular: em vez da
// tabela larga (que obrigava a arrastar a tela pros lados pra ver tudo), aparecem
// "cartões" empilhados com Data/Turno, Saída-Retorno, Origem, Destino, Passageiros, ATF,
// Situação e Motorista(s) - o mesmo modelo que os motoristas já usam hoje numa planilha.
// No tablet/desktop continua sendo a tabela de sempre, com tudo que já tinha.
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

  // ---- 1) CELULAR: cartões visíveis, tabela escondida ----
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

  await loginAs(page, 'motorista@teste.com');
  await page.click('#btnMenuMobile');
  await page.waitForTimeout(100);
  await page.click('.sidebar-link[data-screen="agenda"]');
  await page.waitForTimeout(200);

  const tabelaVisivel = await page.isVisible('.agenda-table-wrap');
  const cartoesVisiveis = await page.isVisible('#agendaCardsList');
  if (!tabelaVisivel && cartoesVisiveis) ok('no celular, a tabela larga fica escondida e os cartões aparecem no lugar dela');
  else fail(`estado errado no celular: tabela visível=${tabelaVisivel}, cartões visíveis=${cartoesVisiveis}`);

  const qtdCartoes = await page.locator('#agendaCardsList > div').count();
  if (qtdCartoes > 0) ok(`${qtdCartoes} cartão(ões) de viagem renderizado(s) na lista`);
  else fail('nenhum cartão de viagem foi renderizado');

  const primeiroCartaoTexto = await page.locator('#agendaCardsList > div').first().innerText();
  const temCampos = ['Saída', 'Origem', 'Destino', 'Passageiros', 'ATF', 'Motorista'].every((campo) => primeiroCartaoTexto.includes(campo));
  if (temCampos) ok('o cartão mostra Saída/Retorno, Origem, Destino, Passageiros, ATF e Motorista(s)');
  else fail('faltou algum campo esperado no cartão: ' + primeiroCartaoTexto);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  if (scrollWidth <= viewportWidth + 2) ok('a tela de Agenda não tem mais scroll horizontal no celular');
  else fail(`ainda tem scroll horizontal: scrollWidth=${scrollWidth} vs viewport=${viewportWidth}`);

  if (errors.length) fail('erros de console/página (celular): ' + JSON.stringify(errors));
  else ok('nenhum erro de console/página no celular');
  await page.close();

  // ---- 2) DESKTOP: continua sendo a tabela de sempre, cartões escondidos ----
  const pageD = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageD.route('**cdn.tailwindcss.com**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await pageD.route('**unpkg.com/lucide@latest**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons:function(){}};' }));
  await pageD.route('**cdn.jsdelivr.net/npm/@supabase/supabase-js@2**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await pageD.route('**cdnjs.cloudflare.com/ajax/libs/jspdf/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await pageD.route('**cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await pageD.route('**cdn.jsdelivr.net/npm/chart.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){return{destroy:function(){}};};' }));
  await pageD.route('**cdn.jsdelivr.net/npm/xlsx**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX={utils:{json_to_sheet:function(){return{};},book_new:function(){return{};},book_append_sheet:function(){}},writeFile:function(){}};' }));
  await loginAs(pageD, 'admin@teste.com');
  await pageD.click('.sidebar-link[data-screen="agenda"]');
  await pageD.waitForTimeout(200);
  const tabelaVisivelDesktop = await pageD.isVisible('.agenda-table-wrap');
  const cartoesVisiveisDesktop = await pageD.isVisible('#agendaCardsList');
  if (tabelaVisivelDesktop && !cartoesVisiveisDesktop) ok('no desktop, a tabela continua aparecendo normalmente e os cartões ficam escondidos');
  else fail(`estado errado no desktop: tabela visível=${tabelaVisivelDesktop}, cartões visíveis=${cartoesVisiveisDesktop}`);
  await pageD.close();

  // ---- 3) KM RODADO (celular): botão de registrar odômetro no topo, acima dos gráficos ----
  const page3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page3.route('**cdn.tailwindcss.com**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page3.route('**unpkg.com/lucide@latest**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons:function(){}};' }));
  await page3.route('**cdn.jsdelivr.net/npm/@supabase/supabase-js@2**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page3.route('**cdnjs.cloudflare.com/ajax/libs/jspdf/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page3.route('**cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page3.route('**cdn.jsdelivr.net/npm/chart.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){return{destroy:function(){}};};' }));
  await page3.route('**cdn.jsdelivr.net/npm/xlsx**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX={utils:{json_to_sheet:function(){return{};},book_new:function(){return{};},book_append_sheet:function(){}},writeFile:function(){}};' }));
  await loginAs(page3, 'motorista@teste.com');
  await page3.click('#btnMenuMobile');
  await page3.waitForTimeout(100);
  await page3.click('.sidebar-link[data-screen="km"]');
  await page3.waitForTimeout(200);
  const botaoY = await page3.evaluate(() => document.querySelector('#screen-km button[onclick="openKmModal()"]').getBoundingClientRect().top);
  const graficoY = await page3.evaluate(() => document.querySelector('#chartKm').getBoundingClientRect().top);
  if (botaoY < graficoY) ok('em KM Rodado, o botão "Registrar odômetro" aparece acima do gráfico');
  else fail(`botão não está acima do gráfico: botão y=${botaoY}, gráfico y=${graficoY}`);
  await page3.close();

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES (CARTÕES NA AGENDA / BOTÃO KM) PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);
})();
