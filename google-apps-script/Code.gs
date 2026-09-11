// ============================================================
// BORA LÁ - EXCURSÕES | Google Apps Script: upload dos projetos pedagógicos
//
// Recebe o arquivo que a Escola anexa na tela "Validações" do sistema e salva
// na pasta do Google Drive combinada com você, com o nome "data_unidade" (o
// próprio sistema já manda o nome pronto). Também libera o link de
// visualização de cada arquivo, pra dar pra pré-visualizar dentro da tela da
// Pedagogia (split-screen).
//
// COMO PUBLICAR (veja o passo a passo completo no README.md desta pasta):
//   1. Acesse https://script.google.com (com a SUA conta do Google) > Novo projeto
//   2. Apague o conteúdo padrão e cole todo o código deste arquivo
//   3. Troque FOLDER_ID abaixo pelo ID da pasta do Drive (já está preenchido
//      com o ID da pasta que você passou)
//   4. Implantar > Nova implantação > tipo "Aplicativo da Web"
//      - Executar como: Eu (sua conta)
//      - Quem pode acessar: Qualquer pessoa
//   5. Copie a URL do Web App gerada e cole no sistema, em
//      Cooperativas > Configurações > "URL do Google Apps Script"
// ============================================================

// ID da pasta compartilhada (extraído do link que você passou):
// https://drive.google.com/drive/folders/1e5DmJxI9t57pSdMMMIYtgQLh4Wg4GJrl
const FOLDER_ID = '1e5DmJxI9t57pSdMMMIYtgQLh4Wg4GJrl';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const filename = String(body.filename || 'documento.pdf');
    const mimeType = body.mimeType || 'application/octet-stream';
    const bytes = Utilities.base64Decode(body.fileBase64);
    const blob = Utilities.newBlob(bytes, mimeType, filename);

    const folder = DriveApp.getFolderById(FOLDER_ID);

    // Se já existe um arquivo com esse nome (reenvio da mesma unidade/data), apaga o
    // antigo antes de salvar o novo - "o arquivo novo reescreve o primeiro".
    const existentes = folder.getFilesByName(filename);
    while (existentes.hasNext()) {
      existentes.next().setTrashed(true);
    }

    const file = folder.createFile(blob);
    file.setName(filename);
    // Libera "qualquer um com o link pode ver" - é isso que permite a pré-visualização
    // dentro da tela da Pedagogia. Se preferir restringir ao domínio da prefeitura
    // (Google Workspace), troque por DriveApp.Access.DOMAIN_WITH_LINK.
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      fileId: file.getId(),
      url: 'https://drive.google.com/file/d/' + file.getId() + '/preview',
      viewUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: String(err),
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
