# Valorização Chat

Chat interno no estilo Microsoft Teams, feito em **Python (Flask + Socket.IO)**, para rodar na rede local do escritório. Não depende de internet: tudo (inclusive a biblioteca de tempo real) fica nesta pasta.

## Como instalar (Windows)

1. Instale o **Python 3.10+** em <https://www.python.org/downloads/> marcando **"Add Python to PATH"**.
2. Copie a pasta `valorizacao-chat` para o computador que fará papel de servidor (o que fica ligado o dia todo).
3. Dê dois cliques em **`iniciar.bat`**. Na primeira vez ele cria o ambiente e instala as dependências.
4. Nos outros computadores, abra o navegador em `https://IP-DO-SERVIDOR:5080` (ex.: `https://192.168.0.10:5080`).
   - O endereço exato aparece na janela preta ao iniciar.
   - Para descobrir o IP do servidor: abra o Prompt e digite `ipconfig` (campo "Endereço IPv4").
   - Se não abrir nas outras máquinas, libere a porta 5080 no Firewall do Windows do servidor.

### Por que `https://` e o aviso de certificado

Os navegadores só liberam o **microfone** (mensagens de voz) em páginas `https://`. Por isso o chat cria sozinho,
na primeira execução, um certificado próprio na pasta `certificado/`.

- **Na primeira vez**, cada navegador mostra "Sua conexão não é particular". Clique em **Avançado → Continuar para…**. Depois disso não pergunta mais.
- **Para não aparecer o aviso** (opcional): em cada computador, dê dois cliques em `certificado/valorizacao-chat.crt`
  → **Instalar Certificado** → **Máquina Local** → **Colocar todos os certificados no repositório a seguir** →
  **Autoridades de Certificação Raiz Confiáveis** → Concluir. Reabra o navegador.
- Se o IP do servidor mudar, apague a pasta `certificado/` e reinicie o chat para gerar um novo.
- Para voltar ao modo antigo, sem HTTPS (as mensagens de voz deixam de funcionar na rede): no `iniciar.bat`, troque para `set HTTPS=0`.

Linux/macOS: `pip install -r requirements.txt` e `python3 app.py`.
Para usar outra porta: defina a variável `PORTA` (ex.: `set PORTA=...` no iniciar.bat antes de iniciar).

## Colocar na nuvem (acesso pelas unidades, de qualquer internet)

A pasta `nuvem/` tem um kit para instalar o chat numa máquina gratuita do **Oracle Cloud** (Ubuntu),
com HTTPS de certificado válido, início automático e backup diário:

```bash
sudo bash nuvem/instalar.sh chat.seudominio.com.br ti@seudominio.com.br
```

O passo a passo completo (criar a conta, a máquina, liberar portas, apontar o endereço e levar as
mensagens atuais) está em **`nuvem/GUIA-NUVEM.md`**.

## Primeiro acesso

- Usuário: **admin** · Senha: **admin123**
- O sistema obriga a trocar a senha no primeiro login (vale também para cada usuário novo).

## Onde ficam armazenadas as mensagens

| O quê | Onde |
|---|---|
| Mensagens, usuários, grupos | `chat.db` (banco SQLite, criado automaticamente) |
| Arquivos enviados | pasta `uploads/` |
| Fotos de perfil | pasta `uploads/fotos/` (320×320, JPEG) |
| Mensagens de voz | pasta `uploads/` (junto dos anexos) |
| Certificado HTTPS | pasta `certificado/` (gerado automaticamente) |

- O histórico é **permanente**: reiniciar o servidor não apaga nada.
- "Apagar mensagem" é uma exclusão lógica — some da tela, mas o registro continua no banco (útil para auditoria).
- Excluir um usuário remove o acesso dele, mas mantém as mensagens que ele já enviou.
- **Backup**: copie `chat.db` e a pasta `uploads/` (ex.: para o servidor de rede) com o chat fechado, ou agende uma cópia diária.

## Funcionalidades

- Conversas individuais e grupos (canal **Geral** criado automaticamente com todos os usuários)
- Mensagens em tempo real, indicador de "digitando…", status online/offline
- Contador de não lidas, filtros (Todas, Não lidas, Pessoas, Grupos)
- Envio de arquivos e imagens (botão de clipe, arrastar e soltar ou colar com Ctrl+V), até 25 MB
- Aba "Arquivos" na conversa, busca no histórico, emojis
- **Editar mensagem enviada** a qualquer momento (menu ⋯ → Editar, ícone de lápis, ou seta ↑ na caixa vazia para editar a última). Aparece a marca "Editada" para todos
- **Apagar para todos** a qualquer momento (menu ⋯ → Apagar para todos), com confirmação. Some na hora para todos os participantes. O administrador também pode apagar mensagens de outros usuários
- **Foto de perfil**: cada usuário troca a sua pelo menu do avatar (canto superior direito) → "Alterar foto de perfil", com recorte circular, zoom e arrastar para enquadrar. O administrador também pode colocar ou remover a foto de qualquer usuário em Administração → Editar. A foto atualiza na hora para todos
- **Responder mensagem**: passe o mouse na mensagem e clique na seta ↩ (ou menu ⋯ → Responder). A mensagem original aparece citada; clicar na citação leva até ela. Esc cancela
- **Mensagens de voz**: botão de microfone na caixa de texto. Grave (até 5 min), pare para ouvir antes ou envie direto. O player tem barra de ondas, avanço por clique e velocidade 1x / 1,5x / 2x. Arquivos de áudio anexados (mp3, m4a, ogg, wav) também tocam na conversa
- **Reuniões (Microsoft Teams ou Google Meet)**: botão **Reunião** no topo de cada conversa ou grupo. Escolha a plataforma, "Agora" ou "Agendar", e o chat abre o Teams / Meet / Google Agenda já preenchido para você gerar o link. Cole o link e o convite vira um cartão com **Entrar na reunião**, **Copiar link** e **Salvar na agenda (.ics)**. O painel **Reuniões** (barra lateral) lista as de hoje e as próximas, e todos recebem um lembrete 5 minutos antes. Dá para salvar uma "sala fixa" por plataforma. Links do Teams ou do Meet colados numa mensagem comum também viram atalho para entrar
- Toda edição e exclusão guarda a versão anterior no banco (tabela `mensagens_versoes`). O administrador vê as versões anteriores pelo menu ⋯
- Notificações na área de trabalho e som de aviso
- Layout responsivo (funciona no celular conectado ao Wi-Fi do escritório)
- **Administração**: criar, editar, desativar e excluir usuários; redefinir senha; definir outros administradores; cargo e unidade (Matriz – Del Castilho, Caxias, Barra); painel com totais

## Estrutura

```
app.py              servidor (rotas, banco e tempo real)
templates/          páginas HTML (login, chat, admin)
static/             CSS, JavaScript (chat.js, midia.js, comum.js), logo
chat.db             banco de dados (criado na 1ª execução)
uploads/            arquivos enviados, mensagens de voz e fotos de perfil
certificado/        certificado HTTPS (criado na 1ª execução)
iniciar.bat         atalho para iniciar no Windows
nuvem/              kit de instalação na nuvem (instalar.sh, importar-dados.sh, GUIA-NUVEM.md)
```
