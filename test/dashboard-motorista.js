// Testa que o Dashboard do motorista mostra só as informações das viagens dele (cartões
// de resumo e os dois gráficos), e que o filtro "Unidade" (que só serve pra quem vê
// viagens de várias unidades) sumiu de lá - igual já acontecia pro perfil Escola.
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
  await page.route('**cdn.jsdelivr.net/npm/xlsx**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX={utils:{json_to_sheet:function(){return{};},book_new:function(){return{};},book_append_sheet:function(){}},writeFile:function(){}};' }));
  // Não troca o chart.js de verdade por um script vazio aqui de propósito - o
  // addInitScript logo abaixo já substitui window.Chart por um "espião" antes de
  // qualquer script rodar, então o pedido de rede pro chart.js real (que a sandbox
  // bloqueia) só precisa ser interceptado pra não gerar erro de console à toa.
  await page.route('**cdn.jsdelivr.net/npm/chart.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  // Chart.js real é trocado por um "espião": guarda a configuração (labels/dados) de cada
  // gráfico criado, em vez de só um stub vazio - assim dá pra conferir o conteúdo real dos
  // dois gráficos do Dashboard (por mês, por unidade), não só se a tela não quebrou.
  await page.addInitScript(() => {
    window.__chartConfigs = [];
    window.Chart = function (ctx, config) { window.__chartConfigs.push(config); return { destroy() {} }; };
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // ---- 1) ADMIN: referência - vê todas as viagens (linha de base pra comparar) ----
  await loginAs(page, 'admin@teste.com');
  await page.waitForTimeout(300);
  const aprovadasAdmin = await page.textContent('#statAprovadas');

  // ---- 2) MOTORISTA (João Silva/d1): só e3 (Teatro Municipal) e e5 (Biblioteca Pública),
  //         ambas com situação "Confirmada" -> statAprovadas deve ser 2, bem menor que o
  //         total do admin, e o filtro de Unidade deve estar escondido. O motorista não
  //         "pousa" no Dashboard depois do login (a tela dele por padrão é "Minhas
  //         Viagens") - precisa clicar em "📊 Dashboard" na lateral pra chegar lá. ----
  await page.click('button[onclick="logout()"]').catch(() => {});
  await page.waitForTimeout(150);
  await page.evaluate(() => { window.__chartConfigs = []; });
  await loginAs(page, 'motorista@teste.com');
  await page.click('.sidebar-link[data-screen="dashboard"]');
  await page.waitForTimeout(300);

  const aprovadasMotorista = await page.textContent('#statAprovadas');
  if (aprovadasMotorista.trim() === '2' && aprovadasMotorista !== aprovadasAdmin) {
    ok(`cartão "Aprovadas" do motorista mostra só as viagens dele (${aprovadasMotorista}), diferente do admin (${aprovadasAdmin})`);
  } else {
    fail(`cartão "Aprovadas" do motorista não bateu: motorista=${aprovadasMotorista}, admin=${aprovadasAdmin}`);
  }

  const filtroUnidadeVisivel = await page.isVisible('#dashFiltroUnidadeWrap');
  if (!filtroUnidadeVisivel) ok('filtro de Unidade sumiu do Dashboard do motorista');
  else fail('filtro de Unidade ainda aparece no Dashboard do motorista');

  const configs = await page.evaluate(() => window.__chartConfigs);
  const configMes = configs.find((c) => c.options?.plugins?.title?.text === 'Viagens por mês');
  const configUnidade = configs.find((c) => c.options?.plugins?.title?.text === 'Viagens por unidade solicitante');
  const totalMes = (configMes?.data?.datasets?.[0]?.data || []).reduce((a, b) => a + b, 0);
  const totalUnidade = (configUnidade?.data?.datasets?.[0]?.data || []).reduce((a, b) => a + b, 0);
  if (totalMes === 2 && totalUnidade === 2) {
    ok(`os dois gráficos do Dashboard (por mês e por unidade) somam só as 2 viagens do motorista (totalMes=${totalMes}, totalUnidade=${totalUnidade})`);
  } else {
    fail(`gráficos do motorista não bateram: totalMes=${totalMes}, totalUnidade=${totalUnidade} (esperado 2 e 2)`);
  }

  // ---- 3) ESCOLA: continua sem o filtro de Unidade (regressão) ----
  await page.click('button[onclick="logout()"]').catch(() => {});
  await page.waitForTimeout(150);
  await loginAs(page, 'escola@teste.com');
  await page.waitForTimeout(300);
  const filtroUnidadeVisivelEscola = await page.isVisible('#dashFiltroUnidadeWrap');
  if (!filtroUnidadeVisivelEscola) ok('filtro de Unidade continua escondido no Dashboard da Escola (sem regressão)');
  else fail('filtro de Unidade reapareceu indevidamente no Dashboard da Escola');

  // ---- 4) ADMIN: continua COM o filtro de Unidade (regressão) ----
  await page.click('button[onclick="logout()"]').catch(() => {});
  await page.waitForTimeout(150);
  await loginAs(page, 'admin@teste.com');
  await page.waitForTimeout(300);
  const filtroUnidadeVisivelAdmin = await page.isVisible('#dashFiltroUnidadeWrap');
  if (filtroUnidadeVisivelAdmin) ok('filtro de Unidade continua aparecendo no Dashboard do Admin (sem regressão)');
  else fail('filtro de Unidade sumiu indevidamente no Dashboard do Admin');

  if (errors.length) fail('erros de console/página: ' + JSON.stringify(errors));
  else ok('nenhum erro de console/página em todo o fluxo');

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES (DASHBOARD DO MOTORISTA) PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);
})();
