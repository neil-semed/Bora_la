// Testa as 3 novidades do perfil Motorista: a tela "Agenda por Data" (semana vs
// hoje+3 dias), o registro de KM (odômetro início/fim -> km calculado -> dashboard) e,
// do lado do Admin, a edição de qualquer registro de KM + filtro por motorista/período.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8877';
let failures = 0;
function fail(msg) { failures++; console.log('❌ FAIL:', msg); }
function ok(msg) { console.log('✅', msg); }

async function loginAs(page, email) {
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

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });

  // ---- 0) MOTORISTA - atalho de odômetro na lateral (perto do "Sair", pra uso no celular) ----
  await loginAs(page, 'motorista@teste.com'); // cai direto na Agenda (tela padrão do motorista)
  const btnOdometroLateral = page.locator('#btnRegistrarOdometroSidebar');
  if (await btnOdometroLateral.isVisible()) ok('motorista vê o atalho "📟 Registrar odômetro" na lateral, sem precisar entrar em "KM Rodado"');
  else fail('atalho de odômetro na lateral não apareceu para o motorista');
  await btnOdometroLateral.click();
  await page.waitForTimeout(100);
  if (await page.isVisible('#kmModal')) ok('atalho da lateral abre o modal de registro direto da Agenda (sem precisar navegar pra tela KM antes)');
  else fail('atalho da lateral não abriu o modal de registro de odômetro');
  await page.click('#kmModal button:has-text("Cancelar")');
  await page.waitForTimeout(100);

  const posicaoRelativa = await page.evaluate(() => {
    const btnKm = document.getElementById('btnRegistrarOdometroSidebar');
    const btnSair = Array.from(document.querySelectorAll('aside button')).find((b) => b.textContent.includes('Sair'));
    if (!btnKm || !btnSair) return null;
    return btnKm.compareDocumentPosition(btnSair) & Node.DOCUMENT_POSITION_FOLLOWING ? 'sair-depois' : 'sair-antes';
  });
  if (posicaoRelativa === 'sair-depois') ok('botão "Sair" fica logo abaixo do atalho de odômetro na lateral, como pedido');
  else fail('ordem dos botões na lateral não bateu (esperava odômetro antes de Sair): ' + posicaoRelativa);
  await logout(page);

  // ---- 1) MOTORISTA - "Agenda por Data" (hoje + 3 dias sempre alcança a semana seguinte) ----
  await loginAs(page, 'motorista@teste.com');
  await goScreen(page, 'agendadata');
  const btnProximos = page.locator('#btnAgendaDataProximos');
  if (!(await btnProximos.isVisible())) fail('tela "Agenda por Data" não abriu para o motorista');
  const listaTxt = await page.textContent('#agendaPorDataLista');
  if (listaTxt.includes('Teatro Municipal')) ok('modo "Hoje + 3 dias" mostra a viagem de amanhã atribuída ao motorista (Teatro Municipal)');
  else fail('viagem de amanhã não apareceu no modo "Hoje + 3 dias": ' + listaTxt.slice(0, 200));
  if (listaTxt.includes('Nenhuma viagem atribuída')) ok('dias sem viagem aparecem como cards vazios (não escondidos)');
  else fail('esperava pelo menos um card de dia vazio ("Nenhuma viagem atribuída")');

  await page.click('#btnAgendaDataSemana');
  await page.waitForTimeout(100);
  const semanaBtnClass = await page.getAttribute('#btnAgendaDataSemana', 'class');
  if (semanaBtnClass.includes('bg-white')) ok('alternar para "Semana" destaca o botão certo');
  else fail('botão "Semana" não ficou destacado depois de clicado: ' + semanaBtnClass);

  // ---- 2) MOTORISTA - registra odômetro de início e fim do dia ----
  await goScreen(page, 'km');
  let resumoTxt = await page.textContent('#kmHojeResumo');
  if (resumoTxt.includes('Nenhum registro ainda hoje')) ok('tela KM começa o dia sem nenhum registro ainda');
  else fail('esperava "Nenhum registro ainda hoje" antes do 1º registro: ' + resumoTxt);

  await page.click('#kmHojeResumo button:has-text("Registrar início do dia")');
  await page.waitForTimeout(100);
  await page.fill('#kmOdometroInicio', '50000');
  await page.click('#kmModal button:has-text("Salvar")');
  await page.waitForTimeout(200);
  resumoTxt = await page.textContent('#kmHojeResumo');
  if (resumoTxt.includes('50000')) ok('odômetro de início do dia salvo (50000 km)');
  else fail('odômetro de início não refletiu no resumo de hoje: ' + resumoTxt);

  await page.click('#kmHojeResumo button:has-text("Registrar fim do dia")');
  await page.waitForTimeout(100);
  await page.fill('#kmOdometroFim', '50123');
  const preview = await page.textContent('#kmRodadoPreview');
  if (preview.includes('123')) ok('a prévia calcula o km rodado antes mesmo de salvar (123 km)');
  else fail('prévia de km rodado não apareceu certa: ' + preview);
  await page.click('#kmModal button:has-text("Salvar")');
  await page.waitForTimeout(200);
  resumoTxt = await page.textContent('#kmHojeResumo');
  if (resumoTxt.includes('123')) ok('km rodado de hoje calculado e exibido corretamente (123 km)');
  else fail('km rodado de hoje não bateu depois de registrar início+fim: ' + resumoTxt);

  const tabelaTxt = await page.textContent('#kmTable');
  if (tabelaTxt.includes('50000') && tabelaTxt.includes('50123')) ok('registro de hoje aparece na tabela de histórico');
  else fail('registro de hoje não apareceu na tabela de histórico: ' + tabelaTxt.slice(0, 200));

  const semanaKmTxt = await page.textContent('#kmStatSemana');
  if (parseInt(semanaKmTxt, 10) >= 123) ok('estatística de km da semana já soma o registro de hoje');
  else fail('estatística de km da semana não somou o registro de hoje: ' + semanaKmTxt);
  await logout(page);

  // ---- 3) ADMIN - edita um registro de KM de outro motorista e filtra o relatório ----
  await loginAs(page, 'admin@teste.com');
  if (await page.locator('#btnRegistrarOdometroSidebar').isVisible()) fail('atalho de odômetro na lateral não deveria aparecer pra quem não é motorista (admin)');
  else ok('atalho de odômetro na lateral fica escondido pra quem não é motorista');
  await goScreen(page, 'kmadmin');
  let adminTabela = await page.textContent('#kmAdminTable');
  if (adminTabela.includes('João Silva')) ok('admin vê os registros de KM de todos os motoristas (seed de demonstração)');
  else fail('tabela de KM do admin não trouxe os registros seedados: ' + adminTabela.slice(0, 200));

  const linhaJoao = page.locator('#kmAdminTable tr', { hasText: 'João Silva' }).first();
  await linhaJoao.locator('button:has-text("Editar")').click();
  await page.waitForTimeout(100);
  const motoristaSelVisible = await page.isVisible('#kmModalMotoristaWrap select#kmMotoristaId');
  if (motoristaSelVisible) ok('modal de KM do admin mostra o seletor de motorista (motorista comum não vê isso)');
  else fail('admin deveria ver o seletor de motorista no modal de KM');
  await page.fill('#kmOdometroInicio', '10000');
  await page.fill('#kmOdometroFim', '10200');
  await page.click('#kmModal button:has-text("Salvar")');
  await page.waitForTimeout(200);
  adminTabela = await page.textContent('#kmAdminTable');
  if (adminTabela.includes('200 km') || adminTabela.includes('200.0 km')) ok('admin editou o registro de KM de um motorista com sucesso (200 km)');
  else fail('edição do admin não refletiu na tabela: ' + adminTabela.slice(0, 300));

  // filtro por motorista
  const motoristaFiltro = await page.locator('#kmAdminFiltroMotorista option', { hasText: 'João Silva' }).getAttribute('value');
  await page.selectOption('#kmAdminFiltroMotorista', motoristaFiltro);
  await page.waitForTimeout(100);
  adminTabela = await page.textContent('#kmAdminTable');
  if (adminTabela.includes('João Silva') && !adminTabela.includes('Pedro Santos')) ok('filtro por motorista funciona corretamente');
  else fail('filtro por motorista não isolou corretamente as linhas: ' + adminTabela.slice(0, 200));

  // filtro por período (data futura, sem registros)
  await page.selectOption('#kmAdminFiltroMotorista', '');
  await page.fill('#kmAdminFiltroInicio', '2099-01-01');
  await page.waitForTimeout(100);
  adminTabela = await page.textContent('#kmAdminTable');
  if (adminTabela.includes('Nenhum registro encontrado')) ok('filtro por período (data futura) corretamente não encontra nada');
  else fail('filtro por período não funcionou como esperado: ' + adminTabela.slice(0, 200));

  // exportação não deve quebrar a página mesmo com as libs stubadas em branco
  await page.click('button:has-text("📄 PDF")');
  await page.click('button:has-text("📊 Excel")');
  await page.waitForTimeout(200);

  if (errors.length) fail('erros de console/página: ' + JSON.stringify(errors));
  else ok('nenhum erro de console/página em todo o fluxo');

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES (MOTORISTA: AGENDA/KM) PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);
})();
