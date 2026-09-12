# APK do Motorista

Este diretório contém o invólucro Android do perfil **Motorista**. Ele abre apenas
`https://neil-semed.github.io/Bora_la/motorista.html`, com JavaScript e armazenamento
local habilitados para que o login e a agenda funcionem normalmente.

O instalador não é salvo no repositório. O GitHub o cria sob demanda e o oferece na aba
**Actions**, sem custo de hospedagem:

1. No GitHub, abra o repositório e vá em **Actions**.
2. Selecione **Gerar APK do Motorista**.
3. Clique em **Run workflow** e confirme **Run workflow**.
4. Espere o resultado ficar verde (normalmente alguns minutos).
5. Na parte inferior da execução, em **Artifacts**, baixe `Bora-La-Motorista-APK`.
6. Descompacte o download e envie `Bora-La-Motorista.apk` ao celular Android.

No celular, abra o arquivo e autorize a instalação por essa origem quando o Android pedir.
O APK serve para distribuição interna. Como a agenda é carregada da hospedagem atual,
alterações no sistema web continuam aparecendo no aplicativo sem gerar um novo APK.

O workflow usa `assets/favicon-512.png` como ícone do app durante a compilação.
