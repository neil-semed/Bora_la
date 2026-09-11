// Testa as 2 novidades pedidas: (1) no Passo 4/5 de "Nova Solicitação", quando se informa
// aluno(s) PCD, agora também dá pra registrar o documento (CI/CNH/CPF) do aluno e do
// respectivo apoio imediato, não só o nome; (2) ao atribuir motorista(s)/veículo(s) a uma
// viagem, o sistema avisa (e bloqueia) se a capacidade somada dos veículos selecionados
// for menor que o total de passageiros da viagem.
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

  // ---- 1) NOVA SOLICITAÇÃO - Passo 4/5: documento do aluno PCD e do apoio ----
  await goScreen(page, 'solicitacao');
  await page.selectOption('#wEscola', { label: 'EMEF Prof. João Silva' });
  await page.click('#btnNext'); // 1 -> 2
  await page.waitForTimeout(80);
  await page.fill('#wDestino', 'Parque Municipal');
  await page.fill('#wCidade', 'Nova Lima');
  await page.click('#btnNext'); // 2 -> 3
  await page.waitForTimeout(80);
  await page.fill('#wData', '2026-12-10');
  await page.fill('#wHora', '08:00');
  await page.click('#btnNext'); // 3 -> 4
  await page.waitForTimeout(80);

  await page.fill('#wAlunos', '10');
  await page.fill('#wPCA', '1');
  await page.waitForTimeout(80);
  const pcdBoxVisible = await page.isVisible('#wPcdBox');
  if (pcdBoxVisible) ok('Passo 4: informar Nº de Alunos PCD abre a caixa de detalhamento');
  else fail('caixa de detalhamento do PCD não abriu');

  const rowLabels = await page.locator('#wPcdRows label').allTextContents();
  if (rowLabels.some((t) => t.includes('Documento do aluno')) && rowLabels.some((t) => t.includes('Documento do apoio'))) {
    ok('linha do aluno PCD tem campo de documento tanto do aluno quanto do apoio');
  } else {
    fail('campos de documento do aluno/apoio não apareceram: ' + JSON.stringify(rowLabels));
  }

  const row = page.locator('#wPcdRows > div').first();
  await row.locator('input').nth(0).fill('Aluno Cinco'); // nome do aluno
  await row.locator('input').nth(1).fill('12.345.678-9'); // documento do aluno
  await row.locator('input').nth(2).fill('Apoio da Silva'); // nome do apoio
  await row.locator('input').nth(3).fill('98.765.432-1'); // documento do apoio
  await page.selectOption('#wPublicoAlvo', 'fundamental_iniciais');

  await page.click('#btnNext'); // 4 -> 5
  await page.waitForTimeout(80);
  await page.click('#btnNext'); // envia
  await page.waitForTimeout(200);

  const salvo = await page.evaluate(() => {
    const trip = agenda.find((a) => a.destination === 'Parque Municipal');
    return trip ? trip.pcd_students : null;
  });
  if (salvo && salvo.length === 1 && salvo[0].nome_aluno === 'Aluno Cinco' && salvo[0].documento_aluno === '12.345.678-9'
    && salvo[0].nome_apoio === 'Apoio da Silva' && salvo[0].documento_apoio === '98.765.432-1') {
    ok('viagem criada salvou nome + documento do aluno PCD e do apoio corretamente');
  } else {
    fail('dados do aluno PCD/apoio não foram salvos como esperado: ' + JSON.stringify(salvo));
  }

  // ---- 2) AGENDA - atribuir motorista(s): capacidade insuficiente é bloqueada e avisada ----
  await goScreen(page, 'agenda');
  const linhaE2 = page.locator('#agendaTable tr', { hasText: 'Parque Ecológico' });
  await linhaE2.locator('button:has-text("Aprovar e atribuir motorista(s)")').click();
  await page.waitForTimeout(100);

  // Parque Ecológico (e2): 25 alunos + 2 acompanhantes = 27 passageiros.
  // Marca só o Pedro Santos (van de 15 lugares) - deve ficar insuficiente.
  const pedroCheck = page.locator('.assign-driver-check', { hasText: '' }).locator('xpath=..').filter({ hasText: 'Pedro Santos' });
  await page.locator('label:has-text("Pedro Santos")').locator('input.assign-driver-check').check();
  await page.waitForTimeout(80);
  const capTxt1 = await page.textContent('#assignCapacidadeTotal');
  if (capTxt1.includes('Lugares insuficientes')) ok('modal de atribuição avisa "Lugares insuficientes" quando a capacidade selecionada é menor que o total de passageiros');
  else fail('aviso de lugares insuficientes não apareceu: ' + capTxt1);

  await page.click('button:has-text("Confirmar aprovação")');
  await page.waitForTimeout(150);
  const aindaAbertoInsuf = await page.isVisible('#assignModal');
  if (aindaAbertoInsuf) ok('confirmar com lugares insuficientes é bloqueado (modal continua aberto)');
  else fail('sistema deixou confirmar atribuição mesmo com lugares insuficientes');

  // Marca também o João Silva (micro-ônibus de 32 lugares) -> 15+32=47, agora é suficiente
  await page.locator('label:has-text("João Silva")').locator('input.assign-driver-check').check();
  await page.waitForTimeout(80);
  const capTxt2 = await page.textContent('#assignCapacidadeTotal');
  if (!capTxt2.includes('insuficientes')) ok('ao completar a capacidade (15+32=47 lugares para 27 passageiros), o aviso de insuficiência some');
  else fail('aviso de insuficiência não sumiu mesmo com capacidade suficiente: ' + capTxt2);

  await page.click('button:has-text("Confirmar aprovação")');
  await page.waitForTimeout(200);
  const modalFechado = !(await page.isVisible('#assignModal'));
  const agendaTxt = await page.textContent('#agendaTable');
  if (modalFechado && agendaTxt.includes('Parque Ecológico')) ok('atribuição com capacidade suficiente é confirmada normalmente');
  else fail('atribuição com capacidade suficiente não foi confirmada como esperado');

  if (errors.length) fail('erros de console/página: ' + JSON.stringify(errors));
  else ok('nenhum erro de console/página em todo o fluxo');

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES (PCD DOCUMENTO / CAPACIDADE) PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);
})();
