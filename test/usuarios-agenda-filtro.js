// Testa a nova tela "Usuários" (editar perfil/unidade/motorista de um login que já
// acessou o sistema) e o novo filtro "Unidade" na Agenda Mestra (admin/pedagogia).
// Roda em modo demonstração (sb=null), que já vem com os 4 logins de teste (admin/
// escola/pedagogia/motorista) semeados em DEMO_PROFILES.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8877';
let failures = 0;
function fail(msg) { failures++; console.log('❌ FAIL:', msg); }
function ok(msg) { console.log('✅', msg); }

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

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.fill('#loginEmail', 'admin@teste.com');
  await page.fill('#loginPassword', 'x');
  await page.click('#loginForm button[type=submit]');
  await page.waitForURL('**/app.html', { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState('networkidle');

  // 1) Tela "Usuários" lista os 4 logins de teste
  await page.click('.sidebar-link[data-screen="usuarios"]');
  await page.waitForTimeout(150);
  const usuariosTxt = await page.textContent('#usuariosTable');
  if (['admin@teste.com', 'escola@teste.com', 'pedagogia@teste.com', 'motorista@teste.com'].every((e) => usuariosTxt.includes(e))) {
    ok('tela Usuários lista os 4 logins semeados');
  } else {
    fail('tela Usuários não listou todos os logins esperados: ' + usuariosTxt);
  }

  // 2) Editar pedagogia@teste.com -> trocar o nome, confirmar persistência
  const pedagRow = page.locator('#usuariosTable tr', { hasText: 'pedagogia@teste.com' });
  await pedagRow.locator('button:has-text("Editar")').click();
  await page.waitForTimeout(100);
  await page.fill('#newUserNome', 'Silvia Pedagogia');
  await page.click('#userModal button:has-text("Salvar")');
  await page.waitForTimeout(150);
  const pedagRowTxt = await (await page.locator('#usuariosTable tr', { hasText: 'pedagogia@teste.com' })).textContent();
  if (pedagRowTxt.includes('Silvia Pedagogia')) ok('edição de nome do usuário pedagogia@teste.com foi salva e refletida na tabela');
  else fail('edição de nome não refletiu na tabela: ' + pedagRowTxt);

  // 3) Editar motorista@teste.com -> trocar de "Motorista" pra "Escola" com uma unidade,
  //    confirmando que os campos condicionais (unidade/motorista) aparecem certos
  const motoristaRow = page.locator('#usuariosTable tr', { hasText: 'motorista@teste.com' });
  await motoristaRow.locator('button:has-text("Editar")').click();
  await page.waitForTimeout(100);
  const motoristaWrapVisibleAntes = await page.isVisible('#userMotoristaWrap');
  if (motoristaWrapVisibleAntes) ok('ao editar um usuário com perfil "Motorista", o campo de motorista vinculado aparece');
  else fail('campo de motorista vinculado não apareceu para um usuário com perfil "Motorista"');
  await page.selectOption('#newUserRole', 'escola');
  await page.waitForTimeout(50);
  const escolaWrapVisibleDepois = await page.isVisible('#userEscolaWrap');
  const motoristaWrapVisibleDepois = await page.isVisible('#userMotoristaWrap');
  if (escolaWrapVisibleDepois && !motoristaWrapVisibleDepois) ok('trocar o perfil pra "Escola" mostra o campo de unidade e esconde o de motorista');
  else fail('campos condicionais não reagiram certo à troca de perfil');
  await page.selectOption('#newUserSchoolId', { label: 'EMEF Maria Aparecida' });
  await page.click('#userModal button:has-text("Salvar")');
  await page.waitForTimeout(150);
  const motoristaRowTxt = await (await page.locator('#usuariosTable tr', { hasText: 'motorista@teste.com' })).textContent();
  if (motoristaRowTxt.includes('Escola') && motoristaRowTxt.includes('EMEF Maria Aparecida')) {
    ok('usuário motorista@teste.com virou perfil "Escola" vinculado à unidade certa');
  } else {
    fail('mudança de perfil/unidade não refletiu na tabela: ' + motoristaRowTxt);
  }

  // 4) Agenda: admin vê o filtro "Unidade" e ele filtra corretamente
  await page.click('.sidebar-link[data-screen="agenda"]');
  await page.waitForTimeout(150);
  const filtroVisivelAdmin = await page.isVisible('#filtroUnidadeWrap');
  if (filtroVisivelAdmin) ok('admin vê o filtro "Unidade" na Agenda Mestra');
  else fail('filtro "Unidade" não apareceu na Agenda para o admin');

  const linhasAntes = await page.locator('#agendaTable tr').count();
  await page.selectOption('#filtroUnidade', { label: 'EMEF Prof. João Silva' });
  await page.waitForTimeout(150);
  const agendaFiltradaTxt = await page.textContent('#agendaTable');
  const linhasDepois = await page.locator('#agendaTable tr').count();
  if (linhasDepois <= linhasAntes && !agendaFiltradaTxt.includes('Cachoeira do Cardoso')) {
    // "Cachoeira do Cardoso" é da EMEF Maria Aparecida (s2) no seed de demonstração
    ok('filtro "Unidade" na Agenda restringe corretamente as viagens exibidas');
  } else {
    fail('filtro "Unidade" não restringiu as viagens como esperado: ' + agendaFiltradaTxt);
  }
  await page.selectOption('#filtroUnidade', '');
  await page.waitForTimeout(150);
  await logoutHelper(page);

  // 5) Pedagogia também vê o filtro; escola e motorista não veem (agenda já é escopada)
  await loginHelper(page, 'pedagogia@teste.com');
  await page.click('.sidebar-link[data-screen="agenda"]');
  await page.waitForTimeout(150);
  if (await page.isVisible('#filtroUnidadeWrap')) ok('pedagogia também vê o filtro "Unidade" na Agenda');
  else fail('filtro "Unidade" não apareceu na Agenda para a pedagogia');
  await logoutHelper(page);

  await loginHelper(page, 'escola@teste.com');
  await page.click('.sidebar-link[data-screen="agenda"]');
  await page.waitForTimeout(150);
  if (!(await page.isVisible('#filtroUnidadeWrap'))) ok('escola não vê o filtro "Unidade" (a agenda dela já é só da própria unidade)');
  else fail('filtro "Unidade" apareceu indevidamente para a escola');

  // 6) Dashboard: filtro de Mês é um dropdown com o nome do mês (não mais o seletor nativo
  //    de mês/ano do navegador) - e o filtro de Unidade some pro perfil Escola (ela só vê
  //    gráficos das próprias solicitações, então filtrar por unidade não faz sentido)
  await page.click('.sidebar-link[data-screen="dashboard"]');
  await page.waitForTimeout(150);
  if (!(await page.isVisible('#dashFiltroUnidadeWrap'))) ok('Dashboard: filtro "Unidade" não aparece pro perfil Escola');
  else fail('filtro "Unidade" do Dashboard apareceu indevidamente para a escola');
  await logoutHelper(page);

  await loginHelper(page, 'admin@teste.com'); // cai direto no Dashboard (tela padrão do admin)
  await page.waitForTimeout(150);
  const mesTagName = await page.evaluate(() => document.getElementById('dashFiltroMes').tagName);
  const mesOpcoesTxt = await page.locator('#dashFiltroMes option').allTextContents();
  const temNomeDeMes = mesOpcoesTxt.some((t) => /^[A-ZÀ-Ú][a-zà-ú]+ de \d{4}$/.test(t.trim()));
  if (mesTagName === 'SELECT' && temNomeDeMes) {
    ok('Dashboard: filtro "Mês" virou um dropdown com o nome do mês por extenso (ex.: "' + mesOpcoesTxt.find((t) => t.includes(' de ')) + '")');
  } else {
    fail('filtro "Mês" do Dashboard não é o dropdown esperado: ' + mesTagName + ' / opções: ' + JSON.stringify(mesOpcoesTxt));
  }
  if (await page.isVisible('#dashFiltroUnidadeWrap')) ok('Dashboard: filtro "Unidade" continua aparecendo pro Admin');
  else fail('filtro "Unidade" do Dashboard sumiu indevidamente para o admin');

  if (errors.length) fail('erros de console/página: ' + JSON.stringify(errors));
  else ok('nenhum erro de console/página em todo o fluxo');

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES (USUÁRIOS/FILTRO UNIDADE) PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);

  async function loginHelper(page, email) {
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
    await page.fill('#loginEmail', email);
    await page.fill('#loginPassword', 'x');
    await page.click('#loginForm button[type=submit]');
    await page.waitForURL('**/app.html', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
  }
  async function logoutHelper(page) {
    await page.click('button:has-text("Sair")');
    await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
  }
})();
