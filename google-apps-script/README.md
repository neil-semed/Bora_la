# Upload autenticado de projetos pedagógicos para o Google Drive

O script exige uma sessão válida do Supabase e verifica se a pessoa pode acessar a excursão antes de gravar o arquivo. Os documentos ficam disponíveis somente para pessoas do domínio Google Workspace da prefeitura que tenham o link; não são públicos na internet.

## Publicação inicial

1. Acesse `script.google.com` com a conta institucional dona da pasta e crie um projeto.
2. Copie o conteúdo de `Code.gs`.
3. Em **Configurações do projeto → Propriedades do script**, crie:
   - `SUPABASE_URL`: URL do projeto Supabase, por exemplo `https://seu-projeto.supabase.co`.
   - `SUPABASE_ANON_KEY`: chave anônima pública do mesmo projeto.
4. Confira o `FOLDER_ID` no código.
5. Implante como **Aplicativo da Web**, executando como a conta institucional e permitindo acesso para **qualquer pessoa**. Isso permite receber o POST, mas o código rejeita chamadas sem sessão válida e autorização no Supabase.
6. Copie a URL `/exec` e salve-a em **Cooperativas → Configurações de envio** no Bora Lá.

O uso de `DOMAIN_WITH_LINK` exige Google Workspace. Caso a conta dona da pasta seja pessoal, migre a pasta para a conta institucional antes de publicar; não troque a permissão para “qualquer pessoa com o link”.

## Atualização

Depois de alterar o script: **Implantar → Gerenciar implantações → Editar → Nova versão → Implantar**. A URL permanece a mesma.
