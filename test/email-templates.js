// Testa o texto dos 3 modelos de e-mail pra cooperativa (ATF comum, transporte PCD,
// listagem por veículo) depois do ajuste pedido: frase mais direta ("Solicita-se a
// emissão de ATF..."), linha de "Unidade" + "Endereço" (vindo do cadastro da unidade, ou
// dos dados digitados quando é "Outra (não cadastrada)"), e os rótulos "Estudante:"/
// "Apoio:" na listagem do e-mail de PCD. Também testa a divisão do campo único "Contato
// (telefone/e-mail)" da unidade avulsa em dois campos separados (Telefone e E-mail).
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

  // ---- 1) Os 3 modelos de e-mail, pra unidade cadastrada (usa Endereço do cadastro) ----
  const textos = await page.evaluate(() => {
    const tripAtf = {
      school_id: 's1', destination: 'Aquário de São Paulo', destination_address: 'Rua Huet Bacelar, 407', city: 'São Paulo',
      trip_date: '2026-10-15', departure_time: '06:00', return_time: '20:00',
      students_count: 40, companions_count: 4, pca_count: 0, apoio_count: 0,
    };
    const passageiros = [{ nome: 'Ana Beatriz Souza', documento: '12.345.678-9' }];
    const bodyAtf = buildAtfEmailBody(tripAtf, passageiros, ['João Silva']);

    const tripPcd = {
      school_id: 's2', destination: 'Clínica Vida Ativa', destination_address: 'Av. Getúlio Vargas, 850', city: 'Nova Lima',
      trip_date: '2026-10-20', departure_time: '13:00', return_time: '17:00',
    };
    const pcdStudents = [{ nome_aluno: 'Aluno Cinco', documento_aluno: '12.345.678-9', nome_apoio: 'Apoio da Silva', documento_apoio: '98.765.432-1' }];
    const bodyPcd = buildPcdEmailBody(tripPcd, pcdStudents);

    const tripListagem = {
      school_id: 's1', destination: 'Parque Ibirapuera', destination_address: 'Av. Pedro Álvares Cabral, s/n', city: 'São Paulo',
      trip_date: '2026-11-05', departure_time: '07:00', return_time: '18:00',
    };
    const bodyListagem = buildListagemEmailBody(tripListagem, ['d1'], { d1: [{ nome: 'Ana Beatriz Souza', documento: '12.345.678-9' }] }, []);

    return { bodyAtf, bodyPcd, bodyListagem };
  });

  if (textos.bodyAtf.includes('Solicita-se a emissão de ATF para a excursão abaixo:') && textos.bodyAtf.includes('Unidade: EMEF Prof. João Silva')
    && textos.bodyAtf.includes('Endereço: Rua das Flores, 100 - Centro')) {
    ok('e-mail de ATF: frase direta + Unidade/Endereço vindo do cadastro da unidade');
  } else {
    fail('e-mail de ATF não bateu com o esperado: ' + textos.bodyAtf);
  }

  if (textos.bodyPcd.includes('Solicita-se transporte PCD:') && textos.bodyPcd.includes('Unidade: EMEF Maria Aparecida')
    && textos.bodyPcd.includes('Endereço: Av. Brasil, 500 - Cristina') && textos.bodyPcd.includes('Estudante: Aluno Cinco - 12.345.678-9')
    && textos.bodyPcd.includes('Apoio: Apoio da Silva - 98.765.432-1')) {
    ok('e-mail de transporte PCD: Unidade/Endereço do cadastro + rótulos "Estudante:"/"Apoio:" na listagem');
  } else {
    fail('e-mail de transporte PCD não bateu com o esperado: ' + textos.bodyPcd);
  }

  if (textos.bodyListagem.includes('Solicita-se a emissão de ATF para a excursão abaixo:') && !textos.bodyListagem.includes('já aprovada pela Pedagogia')
    && textos.bodyListagem.includes('Unidade: EMEF Prof. João Silva') && textos.bodyListagem.includes('Endereço: Rua das Flores, 100 - Centro')) {
    ok('e-mail de listagem por veículo: frase direta (sem "já aprovada...") + Unidade/Endereço do cadastro');
  } else {
    fail('e-mail de listagem por veículo não bateu com o esperado: ' + textos.bodyListagem);
  }

  // ---- 2) Nova Solicitação com "Outra (não cadastrada)": Telefone e E-mail agora são
  //         campos separados, e o e-mail de ATF usa o nome/endereço digitados ----
  await goScreen(page, 'solicitacao');
  await page.selectOption('#wEscola', '__outra__');
  await page.waitForTimeout(80);
  const outraBoxVisivel = await page.isVisible('#wOutraBox');
  const temTelefoneEEmailSeparados = (await page.locator('#wOutraTelefone').count()) === 1 && (await page.locator('#wOutraEmail').count()) === 1;
  if (outraBoxVisivel && temTelefoneEEmailSeparados) ok('"Outra (não cadastrada)" tem campos separados de Telefone e E-mail (não mais um único "Contato")');
  else fail('campos de Telefone/E-mail separados não apareceram para "Outra (não cadastrada)"');

  await page.fill('#wOutraNome', 'Creche Comunitária Girassol');
  await page.fill('#wOutraEndereco', 'Rua das Acácias, 45 - Bairro Novo');
  await page.fill('#wOutraTelefone', '(31) 98888-7777');
  await page.fill('#wOutraEmail', 'contato@girassol.org.br');
  await page.click('#btnNext'); // 1 -> 2
  await page.waitForTimeout(80);
  await page.fill('#wDestino', 'Zoológico de BH');
  await page.fill('#wCidade', 'Belo Horizonte');
  await page.click('#btnNext'); // 2 -> 3
  await page.waitForTimeout(80);
  await page.fill('#wData', '2026-12-01');
  await page.fill('#wHora', '08:00');
  await page.click('#btnNext'); // 3 -> 4
  await page.waitForTimeout(80);
  await page.fill('#wAlunos', '20');
  await page.selectOption('#wPublicoAlvo', 'fundamental_iniciais');
  await page.click('#btnNext'); // 4 -> 5
  await page.waitForTimeout(80);
  await page.click('#btnNext'); // envia
  await page.waitForTimeout(200);

  const salvo = await page.evaluate(() => {
    const trip = agenda.find((a) => a.destination === 'Zoológico de BH');
    return trip ? { requester_name: trip.requester_name, requester_address: trip.requester_address, requester_contact: trip.requester_contact, requester_email: trip.requester_email } : null;
  });
  if (salvo && salvo.requester_name === 'Creche Comunitária Girassol' && salvo.requester_address === 'Rua das Acácias, 45 - Bairro Novo'
    && salvo.requester_contact === '(31) 98888-7777' && salvo.requester_email === 'contato@girassol.org.br') {
    ok('"Outra (não cadastrada)": nome/endereço/telefone/e-mail salvos corretamente, cada um no seu próprio campo');
  } else {
    fail('dados da unidade avulsa não foram salvos como esperado: ' + JSON.stringify(salvo));
  }

  const bodyOutra = await page.evaluate(() => {
    const trip = agenda.find((a) => a.destination === 'Zoológico de BH');
    return buildAtfEmailBody(trip, [], []);
  });
  if (bodyOutra.includes('Unidade: Creche Comunitária Girassol') && bodyOutra.includes('Endereço: Rua das Acácias, 45 - Bairro Novo')) {
    ok('e-mail de ATF de uma viagem de "Outra unidade" usa o nome/endereço digitados na hora (não o cadastro)');
  } else {
    fail('e-mail de ATF de "Outra unidade" não usou os dados digitados: ' + bodyOutra);
  }

  if (errors.length) fail('erros de console/página: ' + JSON.stringify(errors));
  else ok('nenhum erro de console/página em todo o fluxo');

  await browser.close();
  console.log('\n=== RESULTADO:', failures === 0 ? 'TODOS OS TESTES (MODELOS DE E-MAIL) PASSARAM ✅' : `${failures} FALHA(S) ❌`, '===');
  process.exit(failures === 0 ? 0 : 1);
})();
