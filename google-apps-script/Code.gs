// BORA LÁ - EXCURSÕES | Upload autenticado de propostas e listagens para o Google Drive
// O endpoint valida a sessão do Supabase e a autorização na excursão.
//
// COMO PUBLICAR (gratuito, na conta Google dona da pasta):
//   1. script.google.com > Novo projeto > cole este código > Salvar.
//   2. Implantar > Nova implantação > tipo "App da Web":
//        Executar como: Eu  |  Quem pode acessar: Qualquer pessoa.
//   3. Autorize o acesso ao Drive e copie a URL do App da Web (termina em /exec).
//   4. No Bora Lá (Admin > Cooperativas > URL de upload do Google Drive), cole a URL e salve.
// Os arquivos herdam o compartilhamento da pasta (por isso não há ajuste de permissão
// arquivo a arquivo).

const FOLDER_ID = '1e5DmJxI9t57pSdMMMIYtgQLh4Wg4GJrl';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // listagem em Excel
  'image/jpeg', 'image/png', // documentação financeira (orçamentos fotografados)
];

// Dados públicos do projeto Supabase do Bora Lá (os mesmos do site). Podem ser
// substituídos pelas Propriedades do script, se preferir.
const PADRAO_ = {
  SUPABASE_URL: 'https://rjuzhscynuleypaewgak.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqdXpoc2N5bnVsZXlwYWV3Z2FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NTQwNDAsImV4cCI6MjEwNDIzMDA0MH0.enT2gJB4dy2xz_Z91tPY4ysoJ-GEEn2dpo_RHiy5jAs',
};

function config_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key) || PADRAO_[key];
  if (!value) throw new Error(`Configure a propriedade ${key} no Apps Script.`);
  return value;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

// Requisição GET ao Supabase com o JWT da pessoa (usada em paralelo por authorize_).
function supabaseRequest_(path, token) {
  return {
    url: config_('SUPABASE_URL').replace(/\/$/, '') + path,
    method: 'get',
    headers: { apikey: config_('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  };
}

function parseResposta_(response) {
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Sessão inválida ou sem permissão para esta excursão.');
  return JSON.parse(response.getContentText() || '{}');
}

// Id do usuário lido do próprio token (só para montar a consulta do perfil; a validade
// do token é confirmada em seguida pelo /auth/v1/user, na mesma rodada).
function userIdDoToken_(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Utilities.newBlob(Utilities.base64Decode(payload)).getDataAsString()).sub || '';
  } catch (err) { return ''; }
}

function authorize_(accessToken, excursionId) {
  if (!accessToken || !excursionId) throw new Error('Sessão ou excursão não informada.');
  const sub = userIdDoToken_(accessToken);
  if (!sub) throw new Error('Sessão inválida.');
  // As 3 conferências (sessão, acesso à excursão e perfil) agora vão juntas, em paralelo
  // (antes eram 3 chamadas em sequência). A regra de permissão é a mesma.
  const [userResp, excResp, profResp] = UrlFetchApp.fetchAll([
    supabaseRequest_('/auth/v1/user', accessToken),
    supabaseRequest_(`/rest/v1/excursions?id=eq.${encodeURIComponent(excursionId)}&select=id`, accessToken),
    supabaseRequest_(`/rest/v1/profiles?id=eq.${encodeURIComponent(sub)}&select=role`, accessToken),
  ]);
  const user = parseResposta_(userResp);
  if (!user || !user.id || user.id !== sub) throw new Error('Sessão inválida.');

  // A consulta usa o JWT da pessoa. O RLS só retorna uma excursão que ela pode acessar.
  const rows = parseResposta_(excResp);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Sem permissão para enviar documento desta excursão.');

  const profiles = parseResposta_(profResp);
  const role = Array.isArray(profiles) ? profiles[0]?.role : null;
  if (!['escola', 'admin', 'operacional'].includes(role)) throw new Error('Este perfil não pode enviar documentos.');
}

// ENVIO DIRETO (mais rápido): o script só confere o login e abre uma sessão de upload
// no Google Drive; o navegador manda o arquivo em binário direto para o Drive (sem
// passar pelo script e sem a conversão em texto). Depois, "finalizar" só põe o
// arquivo anterior na lixeira.
function iniciarEnvio_(body) {
  const filename = String(body.filename || 'documento.pdf');
  const mimeType = String(body.mimeType || '');
  const size = Number(body.size || 0);
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) throw new Error('Formato não permitido. Envie PDF, DOC, DOCX, XLSX, JPG ou PNG.');
  if (!size || size > MAX_FILE_BYTES) throw new Error('Arquivo vazio ou maior que 25 MB.');
  const origin = String(body.origin || '');
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) throw new Error('Origem inválida.');
  DriveApp.getFolderById(FOLDER_ID); // garante a permissão de Drive deste script
  const resp = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ name: filename, mimeType: mimeType, parents: [FOLDER_ID] }),
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(size),
      Origin: origin, // libera o envio do navegador (CORS) para este endereço
    },
    muteHttpExceptions: true,
  });
  const headers = resp.getAllHeaders();
  const uploadUrl = headers.Location || headers.location;
  if (resp.getResponseCode() !== 200 || !uploadUrl) throw new Error('Não foi possível abrir o envio no Google Drive.');
  return { ok: true, uploadUrl: uploadUrl };
}

function finalizarEnvio_(body) {
  const anterior = String(body.replaceFileId || '');
  const novo = String(body.fileId || '');
  if (anterior && anterior !== novo) {
    try {
      const antigo = DriveApp.getFileById(anterior);
      if (antigo.getParents().hasNext() && antigo.getParents().next().getId() === FOLDER_ID) antigo.setTrashed(true);
    } catch (err) { /* arquivo antigo já não existe: segue */ }
  }
  return { ok: true };
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    authorize_(String(body.accessToken || ''), String(body.excursionId || ''));
    if (body.action === 'iniciar') return json_(iniciarEnvio_(body));
    if (body.action === 'finalizar') return json_(finalizarEnvio_(body));

    const filename = String(body.filename || 'documento.pdf');
    const mimeType = String(body.mimeType || '');
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) throw new Error('Formato não permitido. Envie PDF, DOC, DOCX, XLSX, JPG ou PNG.');
    const bytes = Utilities.base64Decode(String(body.fileBase64 || ''));
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error('Arquivo vazio ou maior que 25 MB.');

    const folder = DriveApp.getFolderById(FOLDER_ID);
    // Arquivo anterior: o app informa o id dele (replaceFileId) e só ele vai para a lixeira,
    // sem varrer a pasta inteira procurando pelo nome (era a parte mais lenta).
    const anterior = String(body.replaceFileId || '');
    if (anterior) {
      try {
        const antigo = DriveApp.getFileById(anterior);
        if (antigo.getParents().hasNext() && antigo.getParents().next().getId() === FOLDER_ID) antigo.setTrashed(true);
      } catch (err) { /* arquivo antigo já não existe: segue */ }
    }

    // Sem ajuste de permissão por arquivo: o arquivo herda o compartilhamento da pasta.
    const file = folder.createFile(Utilities.newBlob(bytes, mimeType, filename));

    return json_({
      ok: true,
      fileId: file.getId(),
      url: 'https://drive.google.com/file/d/' + file.getId() + '/preview',
      viewUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}
