// Testa o fluxo de Validações pedagógicas por documento: Escola anexa o projeto
// pedagógico, Pedagogia encaminha pro setor certo, pede correções, a Escola reenvia,
// e só então a Pedagogia aceita. Roda em modo demonstração (sb=null) - sem Google Drive
// configurado, então o upload fica "só local" (comportamento esperado e avisado ao usuário).
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
async function goValidacoes(page) {
  await page.click('.sidebar-link[data-screen="validacoes"]');
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

  // 1) ESCOLA cria uma solicitação nova, público-alvo "Educação Infantil" (deveria ir
  //    pro setor "Educação Infantil" automaticamente)
  await loginAs(page, 'escola@teste.com');
  await page.click('.sidebar-link[data-screen="solicitacao"]');
  await page.waitForTimeout(150);
  await page.fill('#wDestino', 'Sítio Encantado');
  await page.fill('#wCidade', 'Nova Lima');
  await page.click('#btnNext');
  await page.fill('#wData', '2026-10-05');
  await page.fill('#wHora', '08:00');
  await page.click('#btnNext');
  await page.fill('#wAlunos', '20');
  await page.selectOption('#wPublicoAlvo', 'educacao_infantil');
  await page.click('#btnNext');
  await page.click('#btnNext'); // enviar
  await page.waitForTimeout(200);

  // 2) ESCOLA anexa o projeto pedagógico na tela Validações
  await goValidacoes(page);
  let erow = page.locator('#validacoesEscolaTable tr', { hasText: 'Sítio Encantado' });
  if (!(await erow.isVisible())) fail('escola não viu a nova solicitação na tela Validações');
  let txt = await erow.textContent();
  if (txt.includes('Aguardando envio')) ok('nova solicitação começa com documento "Aguardando envio"');
  else fail('status inicial do documento não é "Aguardando envio": ' + txt);

  await erow.locator('button:has-text("Anexar")').click();
  await page.waitForTimeout(100);
  await page.setInputFiles('#docFileInput', { name: 'projeto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('conteudo de teste') });
  await page.click('#docUploadModal button:has-text("Enviar")');
  await page.waitForTimeout(200);
  erow = page.locator('#validacoesEscolaTable tr', { hasText: 'Sítio Encantado' });
  txt = await erow.textContent();
  if (txt.includes('Em análise') && txt.includes('.pdf')) ok('documento enviado - status vira "Em análise" e mostra o nome do arquivo');
  else fail('upload não refletiu como esperado: ' + txt);
  await logout(page);

  // 3) PEDAGOGIA vê a solicitação já roteada pro setor "Educação Infantil" e a
  //    ENCAMINHA pra "Étnico-Racial" (simulando o cenário que você descreveu)
  await loginAs(page, 'pedagogia@teste.com');
  await goValidacoes(page);
  // O filtro de setor abre pré-selecionado com o setor da própria pessoa (Ensino
  // Fundamental, no seed de demonstração) - troca pra "Todos" pra ver tudo.
  await page.selectOption('#validacaoFiltroSetor', '');
  await page.waitForTimeout(100);
  let prow = page.locator('#validacoesPedagogiaTable tr', { hasText: 'Sítio Encantado' });
  if (!(await prow.isVisible())) fail('pedagogia não viu "Sítio Encantado" na tela Validações');
  txt = await prow.textContent();
  if (txt.includes('Educação Infantil')) ok('solicitação com público-alvo "Educação Infantil" foi roteada automaticamente pro setor certo');
  else fail('roteamento automático por público-alvo não funcionou: ' + txt);

  await prow.locator('button:has-text("Analisar")').click();
  await page.waitForTimeout(150);
  const docPreviewTxt = await page.textContent('#validacaoDocPreview');
  if (docPreviewTxt.includes('.pdf')) ok('modal de validação mostra o nome do documento enviado (sem Drive configurado, sem pré-visualização real)');
  else fail('modal não mostrou o documento enviado: ' + docPreviewTxt);

  await page.selectOption('#encaminharSetor', 'etnico_racial');
  await page.click('button:has-text("↪️ Encaminhar")');
  await page.waitForTimeout(200);
  prow = page.locator('#validacoesPedagogiaTable tr', { hasText: 'Sítio Encantado' });
  txt = await prow.textContent();
  if (txt.includes('Étnico-Racial')) ok('encaminhamento entre setores funcionou (Educação Infantil -> Étnico-Racial)');
  else fail('encaminhamento não mudou o setor exibido: ' + txt);

  // 4) PEDAGOGIA pede correções (com comentário obrigatório)
  await prow.locator('button:has-text("Analisar")').click();
  await page.waitForTimeout(150);
  await page.selectOption('#parecerSelect', 'correcoes');
  await page.click('button:has-text("Salvar parecer")');
  await page.waitForTimeout(100);
  const modalAindaAberto = await page.isVisible('#validacaoModal');
  if (modalAindaAberto) ok('parecer de correções sem comentário foi bloqueado (comentário é obrigatório)');
  else fail('deveria ter bloqueado o parecer "correções" sem comentário');
  await page.fill('#parecerComentario', 'Falta o cronograma detalhado das atividades.');
  await page.click('button:has-text("Salvar parecer")');
  await page.waitForTimeout(200);
  await logout(page);

  // 5) ESCOLA vê o comentário de correção e reenvia o documento
  await loginAs(page, 'escola@teste.com');
  await goValidacoes(page);
  erow = page.locator('#validacoesEscolaTable tr', { hasText: 'Sítio Encantado' });
  txt = await erow.textContent();
  if (txt.includes('Correções solicitadas') && txt.includes('cronograma')) {
    ok('escola vê o status "Correções solicitadas" e o comentário da pedagogia');
  } else {
    fail('correções não apareceram como esperado pra escola: ' + txt);
  }
  await erow.locator('button:has-text("Reenviar")').click();
  await page.waitForTimeout(100);
  const correcaoBoxTxt = await page.textContent('#docUploadCorrecaoBox');
  if (correcaoBoxTxt.includes('cronograma')) ok('modal de reenvio mostra o pedido de correção da pedagogia');
  else fail('modal de reenvio não mostrou o comentário de correção: ' + correcaoBoxTxt);
  await page.setInputFiles('#docFileInput', { name: 'projeto_v2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('conteudo revisado') });
  await page.click('#docUploadModal button:has-text("Enviar")');
  await page.waitForTimeout(200);
  erow = page.locator('#validacoesEscolaTable tr', { hasText: 'Sítio Encantado' });
  txt = await erow.textContent();
  if (txt.includes('Em análise')) ok('reenvio do documento volta o status pra "Em análise"');
  else fail('reenvio não voltou o status pra "Em análise": ' + txt);
  await logout(page);

  // 6) PEDAGOGIA (agora no setor Étnico-Racial) aceita -> vira "pedagogy_approved" e
  //    reflete na Agenda (Situação "Aprovada", já que o destino é em Nova Lima)
  await loginAs(page, 'pedagogia@teste.com');
  await goValidacoes(page);
  await page.selectOption('#validacaoFiltroSetor', 'etnico_racial');
  await page.waitForTimeout(100);
  prow = page.locator('#validacoesPedagogiaTable tr', { hasText: 'Sítio Encantado' });
  if (!(await prow.isVisible())) fail('filtro por setor "Étnico-Racial" não mostrou a solicitação encaminhada pra lá');
  else ok('filtro por setor mostra corretamente a solicitação já encaminhada');
  await prow.locator('button:has-text("Analisar")').click();
  await page.waitForTimeout(150);
  await page.selectOption('#parecerSelect', 'aceito');
  await page.click('button:has-text("Salvar parecer")');
  await page.waitForTimeout(200);
  prow = page.locator('#validacoesPedagogiaTable tr', { hasText: 'Sítio Encantado' });
  if (!(await prow.isVisible())) ok('depois de aceita, a solicitação sai da fila de pendentes da tela Validações');
  else fail('solicitação aceita ainda aparece na fila de pendentes');

  await page.click('.sidebar-link[data-screen="agenda"]');
  await page.waitForTimeout(150);
  const arow = page.locator('#agendaTable tr', { hasText: 'Sítio Encantado' });
  const arowTxt = await arow.textContent();
  if (arowTxt.includes('Aprovada')) ok('depois do aceite final, a Agenda mostra Situação "Aprovada" (destino em Nova Lima)');
  else fail('Situação não virou "Aprovada" na Agenda: ' + arowTxt);

  if (errors.length) fail('erros de console/página: ' + JSON.stringify(errors));
  else ok('nenhum erro de console/página em todo o fluxo');

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES (VALIDAÇÕES) PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);
})();
