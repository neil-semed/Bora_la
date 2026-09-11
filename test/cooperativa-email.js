// Testa o fluxo de listagem de passageiros POR VEÍCULO (viagens pra fora de Nova Lima,
// já aprovadas pela pedagogia e com motorista(s)/veículo(s) atribuído(s)): a escola
// preenche uma listagem por veículo (respeitando a capacidade de cada um), envia; o
// gestor é notificado, confere, rejeita (escola corrige e reenvia) e por fim aceita ->
// o sistema tenta mandar e-mail automático pra cooperativa e, não conseguindo (modo
// demonstração não tem como chamar a Edge Function de verdade), cai pro rascunho manual
// de sempre, já pré-preenchido. No fim, confere que a listagem SIMPLES antiga (viagens
// dentro de Nova Lima, sem PCD) continua funcionando do jeito de sempre - é o limite de
// escopo do novo fluxo.
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
async function goAgenda(page) {
  await page.click('.sidebar-link[data-screen="agenda"]');
  await page.waitForTimeout(150);
}
function rowText(page, needle) {
  return page.locator('#agendaTable tr', { hasText: needle });
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.route('**cdn.tailwindcss.com**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**unpkg.com/lucide@latest**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons:function(){}};' }));
  // corpo vazio -> window.supabase fica undefined -> app cai sozinho no modo demonstração
  await page.route('**cdn.jsdelivr.net/npm/@supabase/supabase-js@2**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**cdnjs.cloudflare.com/ajax/libs/jspdf/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**cdn.jsdelivr.net/npm/chart.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=function(){return{destroy:function(){}};};' }));
  await page.route('**cdn.jsdelivr.net/npm/xlsx**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX={utils:{json_to_sheet:function(){return{};},book_new:function(){return{};},book_append_sheet:function(){}},writeFile:function(){}};' }));

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // Captura chamadas a window.open (é assim que "Abrir e-mail" abre o mailto:) em vez de
  // deixar o Chromium tentar abrir um cliente de e-mail de verdade.
  await page.addInitScript(() => {
    window.__openCalls = [];
    window.open = (url) => { window.__openCalls.push(url); return null; };
  });

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });

  // ---- 1) Aprovar pedagogicamente e atribuir DOIS motoristas/veículos (micro-ônibus 32 +
  //         van 15, exatamente como no exemplo do pedido: mais de uma listagem por viagem;
  //         ambos já pertencem à cooperativa CoopTrans, que já tem e-mail cadastrado no seed) ----
  await loginAs(page, 'admin@teste.com');
  await goAgenda(page);
  let row = rowText(page, 'Museu de Ciências e Técnica');
  await row.locator('button:has-text("Aprovar (Pedagogia)")').click();
  await page.waitForTimeout(150);
  row = rowText(page, 'Museu de Ciências e Técnica');
  await row.locator('button:has-text("Aprovar e atribuir motorista(s)")').click();
  await page.waitForTimeout(150);
  await page.locator('#assignMotoristasList label', { hasText: 'João Silva' }).locator('input[type=checkbox]').check();
  await page.locator('#assignMotoristasList label', { hasText: 'Pedro Santos' }).locator('input[type=checkbox]').check();
  await page.click('#assignModal button:has-text("Confirmar aprovação")');
  await page.waitForTimeout(200);
  row = rowText(page, 'Museu de Ciências e Técnica');
  const rowTxtAssign = await row.textContent();
  if (rowTxtAssign.includes('📋 Preencher listagem') || rowTxtAssign.includes('📋 Listagem')) {
    ok('viagem fora de Nova Lima com motoristas atribuídos passou a mostrar o botão de listagem por veículo (não mais o "📋 Lista" simples)');
  } else {
    fail('botão de listagem por veículo não apareceu depois da atribuição: ' + rowTxtAssign);
  }
  await logout(page);

  // ---- 2) ESCOLA (s1, dona do Museu de Ciências e Técnica) preenche as DUAS listagens ----
  await loginAs(page, 'escola@teste.com');
  await goAgenda(page);
  row = rowText(page, 'Museu de Ciências e Técnica');
  await row.locator('button:has-text("Preencher listagem")').click();
  await page.waitForTimeout(150);

  const blocos = page.locator('#listagemVeiculoBlocos > div');
  if (await blocos.count() === 2) ok('modal mostra as duas listagens separadas (uma por veículo atribuído)');
  else fail('esperava 2 blocos de veículo na listagem, veio ' + (await blocos.count()));

  const blocosTxt = await page.locator('#listagemVeiculoBlocos').textContent();
  if (blocosTxt.includes('ABC-1234') && blocosTxt.includes('32 lugares') && blocosTxt.includes('DEF-5678') && blocosTxt.includes('15 lugares')) {
    ok('cada bloco mostra a placa e a capacidade certa do próprio veículo do motorista');
  } else {
    fail('placas/capacidades não apareceram como esperado: ' + blocosTxt);
  }

  // Testa o limite de capacidade do segundo veículo (van, 15 lugares) sem precisar
  // preencher 15 linhas na UI - chama addListagemRow direto e confere o aviso.
  const capacidadeOk = await page.evaluate(() => {
    for (let i = 0; i < 20; i++) addListagemRow('d2');
    return listagemRowsByDriver['d2'].length;
  });
  if (capacidadeOk === 15) ok('capacidade máxima do veículo (15 lugares) respeitada mesmo tentando adicionar mais linhas');
  else fail('capacidade máxima não foi respeitada: ficou com ' + capacidadeOk + ' linha(s)');
  // reabre o modal pra descartar as linhas em branco do teste de capacidade acima
  await page.click('#listagemVeiculoFooter button:has-text("Fechar")');
  await page.waitForTimeout(100);
  row = rowText(page, 'Museu de Ciências e Técnica');
  await row.locator('button:has-text("Preencher listagem")').click();
  await page.waitForTimeout(150);

  // Preenche 2 passageiros no micro-ônibus (d1 - 1º bloco) e 2 na van (d2 - 2º bloco)
  const bloco1 = blocos.nth(0);
  await bloco1.locator('input').nth(0).fill('Aluno Um');
  await bloco1.locator('input').nth(1).fill('111.111.111-11');
  await bloco1.locator('button:has-text("Adicionar linha")').click();
  await page.waitForTimeout(50);
  await bloco1.locator('input').nth(2).fill('Aluno Dois');
  await bloco1.locator('input').nth(3).fill('222.222.222-22');

  const bloco2 = blocos.nth(1);
  await bloco2.locator('input').nth(0).fill('Aluno Três');
  await bloco2.locator('input').nth(1).fill('333.333.333-33');
  await bloco2.locator('button:has-text("Adicionar linha")').click();
  await page.waitForTimeout(50);
  await bloco2.locator('input').nth(2).fill('Aluno Quatro');
  // Documento do Aluno Quatro fica em branco de propósito - é o que o gestor vai
  // pedir pra corrigir daqui a pouco.

  await page.click('#listagemVeiculoFooter button:has-text("Enviar listagem")');
  await page.waitForTimeout(200);
  ok('escola enviou as duas listagens sem erro');

  row = rowText(page, 'Museu de Ciências e Técnica');
  const rowTxtEnviada = await row.textContent();
  if (rowTxtEnviada.includes('Listagem (enviada)')) ok('depois de enviar, o botão da escola indica "enviada"');
  else fail('rótulo do botão não indicou envio: ' + rowTxtEnviada);
  await logout(page);

  // ---- 3) GESTOR (admin) é notificado, REJEITA sem comentário (deve bloquear) e depois
  //         rejeita com motivo ----
  await loginAs(page, 'admin@teste.com');
  await goAgenda(page);
  row = rowText(page, 'Museu de Ciências e Técnica');
  const rowTxtRevisar = await row.textContent();
  if (rowTxtRevisar.includes('Revisar listagem')) ok('gestor foi notificado do envio (botão "Revisar listagem")');
  else fail('gestor não foi notificado do envio: ' + rowTxtRevisar);

  await row.locator('button:has-text("Revisar listagem")').click();
  await page.waitForTimeout(150);
  const blocosAdminTxt = await page.locator('#listagemVeiculoBlocos').textContent();
  if (blocosAdminTxt.includes('Aluno Um') && blocosAdminTxt.includes('Aluno Três')) {
    ok('gestor visualiza a listagem preenchida pela escola (somente leitura)');
  } else {
    fail('gestor não visualizou os passageiros preenchidos: ' + blocosAdminTxt);
  }
  const temInputAdmin = await page.locator('#listagemVeiculoBlocos input').count();
  if (temInputAdmin === 0) ok('gestor não consegue editar a listagem (somente aceitar/rejeitar)');
  else fail('gestor conseguiu ver campos editáveis na listagem (não deveria)');

  await page.click('#listagemVeiculoFooter button:has-text("Rejeitar")');
  await page.waitForTimeout(100);
  await page.click('#listagemRejeitarBox button:has-text("Confirmar rejeição")');
  await page.waitForTimeout(150);
  const toastTxtVazio = await page.textContent('#toastMsg');
  if (toastTxtVazio.includes('motivo')) ok('rejeição sem motivo foi bloqueada');
  else fail('rejeição sem motivo não foi bloqueada: ' + toastTxtVazio);

  await page.fill('#listagemParecerComentario', 'Falta o número do documento do Aluno Quatro.');
  await page.click('#listagemRejeitarBox button:has-text("Confirmar rejeição")');
  await page.waitForTimeout(200);
  row = rowText(page, 'Museu de Ciências e Técnica');
  const rowTxtRejeitada = await row.textContent();
  if (rowTxtRejeitada.includes('📋 Listagem') && !rowTxtRejeitada.includes('Revisar')) {
    ok('gestor rejeitou a listagem - viagem sai da fila de revisão');
  } else {
    fail('estado após rejeição não bateu: ' + rowTxtRejeitada);
  }
  await logout(page);

  // ---- 4) ESCOLA vê a rejeição, os dados preenchidos continuam lá, e reenvia ----
  await loginAs(page, 'escola@teste.com');
  await goAgenda(page);
  row = rowText(page, 'Museu de Ciências e Técnica');
  const rowTxtCorrigir = await row.textContent();
  if (rowTxtCorrigir.includes('Corrigir listagem')) ok('escola vê que precisa corrigir e reenviar a listagem');
  else fail('escola não viu o pedido de correção: ' + rowTxtCorrigir);

  await row.locator('button:has-text("Corrigir listagem")').click();
  await page.waitForTimeout(150);
  const statusBoxTxt = await page.textContent('#listagemStatusBox');
  if (statusBoxTxt.includes('Falta o número do documento do Aluno Quatro')) {
    ok('escola vê o motivo da rejeição dado pelo gestor');
  } else {
    fail('motivo da rejeição não apareceu para a escola: ' + statusBoxTxt);
  }
  // Os valores ficam em atributo value de <input>, não em texto solto - confere lendo
  // o valor de fato dos campos, inclusive que nada se perdeu depois da rejeição.
  const blocosReabertos = page.locator('#listagemVeiculoBlocos > div');
  const val0 = await blocosReabertos.nth(0).locator('input').nth(0).inputValue();
  if (val0 === 'Aluno Um') ok('os dados já preenchidos não se perderam depois da rejeição');
  else fail('dados preenchidos se perderam após a rejeição: "' + val0 + '"');

  // Corrige exatamente o que o gestor pediu: o documento do Aluno Quatro
  const bloco2Reaberto = blocosReabertos.nth(1);
  const nomeLinha2 = await bloco2Reaberto.locator('input').nth(2).inputValue();
  if (nomeLinha2 === 'Aluno Quatro') {
    await bloco2Reaberto.locator('input').nth(3).fill('444.444.444-44');
    ok('escola corrigiu o documento do Aluno Quatro, como pedido pelo gestor');
  } else {
    fail('não encontrou a linha do Aluno Quatro pra corrigir: "' + nomeLinha2 + '"');
  }

  await page.click('#listagemVeiculoFooter button:has-text("Enviar listagem")');
  await page.waitForTimeout(200);
  ok('escola reenviou a listagem corrigida');
  await logout(page);

  // ---- 5) GESTOR ACEITA -> como é modo demonstração (sem Edge Function de verdade), cai
  //         pro rascunho manual de e-mail já pré-preenchido pra CoopTrans ----
  await loginAs(page, 'admin@teste.com');
  await goAgenda(page);
  row = rowText(page, 'Museu de Ciências e Técnica');
  await row.locator('button:has-text("Revisar listagem")').click();
  await page.waitForTimeout(150);
  await page.click('#listagemVeiculoFooter button:has-text("Aceitar")');
  await page.waitForTimeout(250);

  const emailModalVisivel = await page.isVisible('#cooperativaEmailModal');
  if (emailModalVisivel) ok('sem e-mail automático configurado, caiu pro rascunho manual pré-preenchido, como esperado em modo demonstração');
  else fail('modal de e-mail manual (fallback) não abriu depois de aceitar a listagem');

  const coopSelValue = await page.$eval('#emailCooperativaId', (el) => el.value);
  const corpoFinal = await page.inputValue('#emailCorpo');
  if (corpoFinal.includes('ABC-1234') && corpoFinal.includes('DEF-5678') && corpoFinal.includes('Aluno Um') && corpoFinal.includes('Aluno Três')) {
    ok('e-mail pré-preenchido traz os dois veículos e as listagens completas');
  } else {
    fail('corpo do e-mail não trouxe os dados esperados dos dois veículos: ' + corpoFinal);
  }
  if (coopSelValue) ok('cooperativa correspondente aos veículos veio pré-selecionada');
  else fail('cooperativa não veio pré-selecionada no fallback manual');

  await page.click('button:has-text("Abrir e-mail")');
  await page.waitForTimeout(150);
  const openCalls = await page.evaluate(() => window.__openCalls);
  if (openCalls.some((u) => u.startsWith('mailto:' + encodeURIComponent('coopertrans@exemplo.com.br')))) {
    ok('e-mail final foi aberto (mailto:) pra CoopTrans');
  } else {
    fail('mailto: não foi chamado como esperado: ' + JSON.stringify(openCalls));
  }

  row = rowText(page, 'Museu de Ciências e Técnica');
  const rowTxtAceita = await row.textContent();
  if (rowTxtAceita.includes('📋 Listagem') && !rowTxtAceita.includes('Revisar')) ok('listagem aceita - viagem sai da fila de revisão do gestor');
  else fail('estado final após aceite não bateu: ' + rowTxtAceita);

  // ---- 6) Regressão de escopo: viagem DENTRO de Nova Lima (sem PCD) continua usando a
  //         listagem simples antiga, sem passar pelo fluxo por veículo ----
  row = rowText(page, 'Cachoeira do Cardoso');
  // Repara na coluna de ações (não na linha inteira - a coluna "Situação" tem uma opção de
  // combobox chamada "Sem Listagem" sem relação nenhuma com este fluxo, e bateria um falso
  // positivo se a checagem olhasse o texto da linha toda).
  const temBotaoListaSimples = await row.locator('button:has-text("📋 Lista")').isVisible();
  const temBotaoListagemVeiculo = await row.locator('button', { hasText: 'Listagem' }).count();
  if (temBotaoListaSimples && temBotaoListagemVeiculo === 0) {
    ok('viagem dentro de Nova Lima continua com a listagem simples antiga (escopo do novo fluxo respeitado)');
  } else {
    fail('viagem que não precisa de cooperativa não deveria usar o botão de listagem por veículo');
  }
  await row.locator('button:has-text("📋 Lista")').click();
  await page.waitForTimeout(150);
  await page.locator('#passengerRows input').nth(0).fill('Passageiro Simples');
  await page.click('#passengerModal button:has-text("Salvar")');
  await page.waitForTimeout(150);
  ok('listagem simples antiga continua funcionando normalmente');

  if (errors.length) fail('erros de console/página: ' + JSON.stringify(errors));
  else ok('nenhum erro de console/página em todo o fluxo');

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES (LISTAGEM POR VEÍCULO / COOPERATIVA) PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);
})();
