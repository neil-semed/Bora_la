# Upload dos projetos pedagógicos para o Google Drive

Este script recebe o arquivo que a Escola anexa na tela **Validações** do Bora Lá e salva
direto na pasta do Google Drive combinada, usando a sua própria conta do Google — assim
nenhuma escola precisa ter (ou autorizar) uma conta Google só pra isso.

## Passo a passo (uma vez só)

1. Acesse **https://script.google.com** já logado com a sua conta do Google (a mesma dona
   da pasta do Drive) e clique em **Novo projeto**.
2. Apague o conteúdo padrão (`function myFunction() {...}`) e cole todo o conteúdo do
   arquivo [`Code.gs`](Code.gs) desta pasta.
3. Confira a constante `FOLDER_ID` no topo do arquivo — já vem preenchida com o ID da
   pasta que você passou (`https://drive.google.com/drive/folders/1e5DmJxI9t57pSdMMMIYtgQLh4Wg4GJrl`).
   Se um dia trocar de pasta, troque esse ID (é o trecho depois de `/folders/` no link).
4. Clique em **Salvar projeto** (ícone de disquete) e dê um nome, ex: "Bora Lá - Upload Drive".
5. Clique em **Implantar → Nova implantação**.
6. No tipo, escolha **Aplicativo da Web** (clique no ícone de engrenagem se não aparecer).
7. Configure:
   - **Executar como:** Eu (sua conta)
   - **Quem pode acessar:** Qualquer pessoa
8. Clique em **Implantar**. Na primeira vez, o Google vai pedir para você autorizar o
   script a acessar seu Google Drive — é normal, é a sua própria conta autorizando.
9. Copie a **URL do aplicativo da Web** (algo como
   `https://script.google.com/macros/s/AKfycb.../exec`).
10. No sistema Bora Lá, entre como Admin, abra **Cooperativas → Configurações de envio**
    e cole essa URL no campo **"URL do Google Apps Script"** → Salvar.

Pronto! A partir daí, toda vez que uma escola anexar o projeto pedagógico na tela
Validações, o arquivo é salvo automaticamente nessa pasta do Drive, nomeado
`data_unidade.extensão` (ex: `2026-03-15_emef-prof-joao-silva.pdf`), e um reenvio
substitui o arquivo anterior com o mesmo nome.

## Se um dia precisar atualizar o script

Edite o `Code.gs` no `script.google.com`, salve, e clique em **Implantar → Gerenciar
implantações → ✏️ (editar) → Nova versão → Implantar**. A URL continua a mesma, não
precisa colar de novo no sistema.

## Sobre permissões dos arquivos

O script deixa cada arquivo enviado com o link de visualização liberado para "qualquer
pessoa com o link" — é isso que permite a pré-visualização dentro da tela da Pedagogia
no Bora Lá. Se a prefeitura tiver Google Workspace e preferir restringir ao domínio
institucional, troque, no `Code.gs`, `DriveApp.Access.ANYONE_WITH_LINK` por
`DriveApp.Access.DOMAIN_WITH_LINK` (nesse caso, a pré-visualização só funciona pra quem
estiver logado com uma conta do domínio).
