// Testa a rodada "bloqueios e exclusão": Bloquear/Reativar em Usuários, Cooperativas,
// Motoristas, Veículos e Unidades (impede login/some das listas de vínculo novo, mas
// preserva histórico); exclusão permanente de viagem na Agenda Mestra (admin, diferente
// de Cancelar); e o botão "+ Novo registro" na tela KM dos Motoristas (admin).
// Roda em modo demonstração (sb=null).
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
async function logout(page) {
  await page.click('button:has-text("Sair")');
  await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState('networkidle');
}
async function goScreen(page, name) {
  await page.click(`.sidebar-link[data-screen="${name}"]`);
  await page.waitForTimeout(150);
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

  await loginAs(page, 'admin@teste.com');

  // ---- 1) USUÁRIOS - bloquear motorista@teste.com impede login; reativar libera de novo ----
  await goScreen(page, 'usuarios');
  const motoristaRow = page.locator('#usuariosTable tr', { hasText: 'motorista@teste.com' });
  await motoristaRow.locator('button:has-text("Bloquear")').click();
  await page.waitForTimeout(150);
  const motoristaRowTxt1 = await motoristaRow.textContent();
  if (motoristaRowTxt1.includes('Bloqueado')) ok('Usuários: motorista@teste.com aparece como "Bloqueado" depois de clicar em Bloquear');
  else fail('badge "Bloqueado" não apareceu depois de bloquear: ' + motoristaRowTxt1);
  await logout(page);

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.fill('#loginEmail', 'motorista@teste.com');
  await page.fill('#loginPassword', 'x');
  await page.click('#loginForm button[type=submit]');
  await page.waitForTimeout(400);
  const urlAposLoginBloqueado = page.url();
  if (urlAposLoginBloqueado.includes('index.html')) ok('usuário bloqueado não consegue entrar (continua em index.html)');
  else fail('usuário bloqueado conseguiu entrar mesmo assim: ' + urlAposLoginBloqueado);

  await loginAs(page, 'admin@teste.com');
  await goScreen(page, 'usuarios');
  const motoristaRow2 = page.locator('#usuariosTable tr', { hasText: 'motorista@teste.com' });
  await motoristaRow2.locator('button:has-text("Desbloquear")').click();
  await page.waitForTimeout(150);
  const motoristaRowTxt2 = await motoristaRow2.textContent();
  if (motoristaRowTxt2.includes('Ativo')) ok('Usuários: Desbloquear reverte o status para "Ativo"');
  else fail('status não voltou pra "Ativo" depois de Desbloquear: ' + motoristaRowTxt2);
  await logout(page);
  await loginAs(page, 'motorista@teste.com');
  if (page.url().includes('app.html')) ok('depois de desbloqueado, o motorista consegue entrar de novo');
  else fail('motorista desbloqueado não conseguiu entrar: ' + page.url());
  await logout(page);

  // ---- 2) COOPERATIVAS - bloquear some da lista de vínculo de motorista, mas mantém histórico ----
  await loginAs(page, 'admin@teste.com');
  await goScreen(page, 'cooperativas');
  const coopRow = page.locator('#cooperativasTable tr', { hasText: 'TransNova' });
  await coopRow.locator('button:has-text("Bloquear")').click();
  await page.waitForTimeout(150);
  if ((await coopRow.textContent()).includes('Bloqueada')) ok('Cooperativas: TransNova aparece como "Bloqueada"');
  else fail('badge "Bloqueada" não apareceu para a cooperativa');
  await goScreen(page, 'motoristas');
  await page.locator('#motoristasTable tr', { hasText: 'João Silva' }).locator('button:has-text("Editar")').click();
  await page.waitForTimeout(100);
  const coopOptsTxt = await page.locator('#newMotoristaCooperativaId option').allTextContents();
  if (!coopOptsTxt.some((t) => t.includes('TransNova'))) ok('cooperativa bloqueada some do seletor de vínculo de um motorista sem essa cooperativa já selecionada');
  else fail('cooperativa bloqueada ainda aparece no seletor: ' + JSON.stringify(coopOptsTxt));
  await page.click('#driverModal button:has-text("Cancelar")');
  await page.waitForTimeout(100);

  // reativa pra não afetar outros testes que rodem depois com dados persistidos
  await goScreen(page, 'cooperativas');
  await page.locator('#cooperativasTable tr', { hasText: 'TransNova' }).locator('button:has-text("Reativar")').click();
  await page.waitForTimeout(150);

  // ---- 3) UNIDADES - bloquear some do seletor de "Nova Solicitação" ----
  await goScreen(page, 'unidades');
  const unidadeRow = page.locator('#unidadesTable tr', { hasText: 'Maria Aparecida' });
  await unidadeRow.locator('button:has-text("Bloquear")').click();
  await page.waitForTimeout(150);
  if ((await unidadeRow.textContent()).includes('Bloqueada')) ok('Unidades: EMEF Maria Aparecida aparece como "Bloqueada"');
  else fail('badge "Bloqueada" não apareceu para a unidade');
  await goScreen(page, 'solicitacao');
  const escolaOptsTxt = await page.locator('#wEscola option').allTextContents();
  if (!escolaOptsTxt.some((t) => t.includes('Maria Aparecida'))) ok('unidade bloqueada some do seletor de "Nova Solicitação"');
  else fail('unidade bloqueada ainda aparece no seletor de nova solicitação: ' + JSON.stringify(escolaOptsTxt));
  await goScreen(page, 'unidades');
  await page.locator('#unidadesTable tr', { hasText: 'Maria Aparecida' }).locator('button:has-text("Reativar")').click();
  await page.waitForTimeout(150);

  // ---- 4) MOTORISTAS - Bloquear/Reativar troca o badge Ativo/Inativo ----
  await goScreen(page, 'motoristas');
  const pedroRow = page.locator('#motoristasTable tr', { hasText: 'Pedro Santos' });
  await pedroRow.locator('button:has-text("Bloquear")').click();
  await page.waitForTimeout(150);
  if ((await pedroRow.textContent()).includes('Inativo')) ok('Motoristas: Pedro Santos vira "Inativo" ao clicar em Bloquear');
  else fail('motorista não ficou "Inativo" depois de bloquear');
  await pedroRow.locator('button:has-text("Reativar")').click();
  await page.waitForTimeout(150);
  if ((await pedroRow.textContent()).includes('Ativo') && !(await pedroRow.textContent()).includes('Inativo')) ok('Motoristas: Reativar volta pro status "Ativo"');
  else fail('motorista não voltou pra "Ativo" depois de reativar');

  // ---- 5) VEÍCULOS - Bloquear/Reativar troca o badge Ativo/Inativo ----
  await goScreen(page, 'veiculos');
  const veiculoCard = page.locator('.card-hover', { hasText: 'DEF-5678' });
  await veiculoCard.locator('button:has-text("Bloquear")').click();
  await page.waitForTimeout(150);
  if ((await veiculoCard.textContent()).includes('Inativo')) ok('Veículos: DEF-5678 vira "Inativo" ao clicar em Bloquear');
  else fail('veículo não ficou "Inativo" depois de bloquear');
  await veiculoCard.locator('button:has-text("Reativar")').click();
  await page.waitForTimeout(150);
  if ((await veiculoCard.textContent()).includes('Ativo')) ok('Veículos: Reativar volta pro status "Ativo"');
  else fail('veículo não voltou pra "Ativo" depois de reativar');

  // ---- 6) AGENDA MESTRA - exclusão permanente (admin), diferente de Cancelar ----
  await goScreen(page, 'agenda');
  const linhasAntes = await page.locator('#agendaTable tr').count();
  const viagemRow = page.locator('#agendaTable tr', { hasText: 'Parque Aquático' });
  if (await viagemRow.locator('button:has-text("🗑️ Excluir")').isVisible()) ok('admin vê o botão "🗑️ Excluir" na Agenda Mestra');
  else fail('botão "🗑️ Excluir" não apareceu para o admin na Agenda Mestra');
  await viagemRow.locator('button:has-text("🗑️ Excluir")').click();
  await page.waitForTimeout(100);
  const modalInfo = await page.textContent('#deleteExcursionInfo');
  if (modalInfo.includes('Parque Aquático')) ok('modal de exclusão mostra a viagem certa antes de confirmar');
  else fail('modal de exclusão não mostrou a viagem esperada: ' + modalInfo);
  await page.click('#deleteExcursionModal button:has-text("Excluir permanentemente")');
  await page.waitForTimeout(200);
  const agendaTxtDepois = await page.textContent('#agendaTable');
  const linhasDepois = await page.locator('#agendaTable tr').count();
  if (!agendaTxtDepois.includes('Parque Aquático') && linhasDepois < linhasAntes) ok('viagem excluída não aparece mais na Agenda Mestra (exclusão permanente)');
  else fail('viagem excluída ainda aparece na Agenda Mestra: ' + agendaTxtDepois.slice(0, 200));

  await logout(page);
  await loginAs(page, 'escola@teste.com');
  await goScreen(page, 'agenda');
  if (await page.locator('button:has-text("🗑️ Excluir")').count() === 0) ok('perfil Escola não vê o botão "🗑️ Excluir" (só admin)');
  else fail('botão "🗑️ Excluir" apareceu indevidamente para a Escola');
  await logout(page);

  // ---- 7) KM DOS MOTORISTAS (admin) - "+ Novo registro" cria um lançamento novo ----
  await loginAs(page, 'admin@teste.com');
  await goScreen(page, 'kmadmin');
  const linhasKmAntes = await page.locator('#kmAdminTable tr').count();
  await page.click('button:has-text("➕ Novo registro")');
  await page.waitForTimeout(100);
  const tituloKmModal = await page.textContent('#kmModalTitle');
  if (tituloKmModal.includes('Registrar odômetro')) ok('"+ Novo registro" abre o modal de KM em modo de criação (não edição)');
  else fail('modal não abriu no modo esperado: ' + tituloKmModal);
  await page.selectOption('#kmMotoristaId', { label: 'Pedro Santos' });
  await page.fill('#kmData', '2026-01-15');
  await page.fill('#kmOdometroInicio', '77000');
  await page.fill('#kmOdometroFim', '77080');
  await page.click('#kmModal button:has-text("Salvar")');
  await page.waitForTimeout(200);
  const kmAdminTxtDepois = await page.textContent('#kmAdminTable');
  const linhasKmDepois = await page.locator('#kmAdminTable tr').count();
  if (kmAdminTxtDepois.includes('77000') && kmAdminTxtDepois.includes('77080') && linhasKmDepois > linhasKmAntes) {
    ok('"+ Novo registro" criou um novo lançamento de KM para outro motorista/data com sucesso');
  } else {
    fail('novo lançamento de KM via "+ Novo registro" não apareceu na tabela: ' + kmAdminTxtDepois.slice(0, 300));
  }

  if (errors.length) fail('erros de console/página: ' + JSON.stringify(errors));
  else ok('nenhum erro de console/página em todo o fluxo');

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES (BLOQUEIOS/EXCLUSÃO) PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);
})();
