// BORA LÁ - EXCURSÕES | Upload autenticado de projetos pedagógicos
// O endpoint valida a sessão do Supabase e a autorização na excursão.

const FOLDER_ID = '1e5DmJxI9t57pSdMMMIYtgQLh4Wg4GJrl';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

function config_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error(`Configure a propriedade ${key} no Apps Script.`);
  return value;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function supabaseFetch_(path, token) {
  const url = config_('SUPABASE_URL').replace(/\/$/, '') + path;
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { apikey: config_('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Sessão inválida ou sem permissão para esta excursão.');
  return JSON.parse(response.getContentText() || '{}');
}

function authorize_(accessToken, excursionId) {
  if (!accessToken || !excursionId) throw new Error('Sessão ou excursão não informada.');
  const user = supabaseFetch_('/auth/v1/user', accessToken);
  if (!user || !user.id) throw new Error('Sessão inválida.');

  // A consulta usa o JWT da pessoa. O RLS só retorna uma excursão que ela pode acessar.
  const rows = supabaseFetch_(`/rest/v1/excursions?id=eq.${encodeURIComponent(excursionId)}&select=id`, accessToken);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Sem permissão para enviar documento desta excursão.');

  const profiles = supabaseFetch_(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, accessToken);
  const role = Array.isArray(profiles) ? profiles[0]?.role : null;
  if (!['escola', 'admin'].includes(role)) throw new Error('Este perfil não pode enviar documentos.');
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    authorize_(String(body.accessToken || ''), String(body.excursionId || ''));

    const filename = String(body.filename || 'documento.pdf');
    const mimeType = String(body.mimeType || '');
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) throw new Error('Formato não permitido. Envie PDF, DOC ou DOCX.');
    const bytes = Utilities.base64Decode(String(body.fileBase64 || ''));
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error('Arquivo vazio ou maior que 10 MB.');

    const folder = DriveApp.getFolderById(FOLDER_ID);
    const existentes = folder.getFilesByName(filename);
    while (existentes.hasNext()) existentes.next().setTrashed(true);

    const file = folder.createFile(Utilities.newBlob(bytes, mimeType, filename));
    // Requer Google Workspace; nunca libera documentos para a internet inteira.
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);

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
