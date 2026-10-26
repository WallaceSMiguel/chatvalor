# Valorização Chat na nuvem (Oracle Cloud, gratuito)

Com o chat na nuvem, a matriz e as unidades (Caxias, Barra) acessam o mesmo endereço,
`https://chat.seudominio.com.br`, de qualquer internet, inclusive pelo 4G do celular.
O certificado é válido (sem aviso) e o microfone das mensagens de voz funciona em todo lugar.

**Custo:** R$ 0 com a máquina "Always Free" da Oracle. O único gasto possível é um domínio
próprio (~R$ 40/ano no Registro.br). Também dá para usar um subdomínio gratuito do DuckDNS.

---

## 1. Criar a conta na Oracle Cloud

1. Acesse **oracle.com/cloud/free** e crie a conta **Free Tier**.
   A Oracle pede cartão de crédito só para confirmar a identidade; ele não é cobrado.
2. Em **Home Region**, escolha **Brazil East (Sao Paulo)**.
   As máquinas gratuitas só podem ser criadas nessa região, e a escolha é feita uma única vez.

## 2. Criar a máquina

No painel: **Compute → Instances → Create instance**.

| Campo | O que escolher |
|---|---|
| Image | **Canonical Ubuntu 24.04** |
| Shape | **Ampere → VM.Standard.A1.Flex**, 1 OCPU e 6 GB de memória (cabe no gratuito) |
| SSH keys | **Generate a key pair** → **Save private key** (guarde o arquivo `.key`) |
| Public IP | Deixe marcado para receber um IP público |

Se aparecer *"Out of capacity"*, tente de novo mais tarde ou use o shape **VM.Standard.E2.1.Micro**
(1 GB, também gratuito; atende uma equipe pequena).

Anote o **IP público** que aparece na página da máquina.

## 3. Liberar as portas 80 e 443 no painel

**Networking → Virtual cloud networks →** (a rede criada junto com a máquina) **→ Security Lists →
Default Security List → Add Ingress Rules**:

- Source CIDR `0.0.0.0/0`, protocolo TCP, Destination port **80**
- Repita para a porta **443**

(O script de instalação libera essas portas também dentro da máquina.)

## 4. Apontar o endereço para a máquina

- **Domínio próprio:** no painel de DNS do domínio, crie um registro **A** com nome `chat`
  e valor = IP público da máquina.
- **Sem domínio (grátis):** entre em **duckdns.org**, crie um nome (ex.: `valorizacao-chat`)
  e informe o IP público. O endereço fica `valorizacao-chat.duckdns.org`.

Espere alguns minutos para o endereço começar a funcionar.

## 5. Enviar a pasta do chat para a máquina

Para levar as mensagens atuais junto, **feche o chat no servidor do escritório** antes de copiar
(a pasta deve conter `chat.db` e `uploads`).

No Windows, abra o **PowerShell** e rode (troque os caminhos e o IP):

```powershell
scp -i C:\caminho\chave.key -r C:\caminho\valorizacao-chat ubuntu@IP-PUBLICO:~
```

Se preferir janelas, use o programa **WinSCP** (protocolo SFTP, usuário `ubuntu`, chave `.key`).

## 6. Instalar

Entre na máquina:

```powershell
ssh -i C:\caminho\chave.key ubuntu@IP-PUBLICO
```

E rode (troque pelo seu endereço e e-mail):

```bash
cd valorizacao-chat
sudo bash nuvem/instalar.sh chat.seudominio.com.br ti@seudominio.com.br
```

Em poucos minutos aparece **"Pronto! Acesse: https://chat.seudominio.com.br"**.
Na primeira visita o certificado é emitido sozinho (leva cerca de 1 minuto).

Se a pasta tinha `chat.db`, as mensagens, usuários, áudios e fotos já estarão lá.
Se não tinha, o primeiro acesso é **admin / admin123** (troque a senha na hora).

---

## Manutenção

| Tarefa | Como |
|---|---|
| Atualizar o chat | Copie a pasta nova (passo 5) e rode `sudo bash nuvem/instalar.sh ...` de novo. Os dados são mantidos. |
| Trazer dados depois | Copie `chat.db` e `uploads` para `/home/ubuntu/dados` e rode `sudo bash nuvem/importar-dados.sh /home/ubuntu/dados` |
| Backups | Automáticos todo dia em `/opt/valorizacao-chat/backups` (14 dias). Baixe uma cópia de vez em quando pelo WinSCP. |
| Ver se está ligado | `sudo systemctl status valorizacao-chat` |
| Ver os registros | `sudo journalctl -u valorizacao-chat -f` |
| Reiniciar | `sudo systemctl restart valorizacao-chat` |

## Cuidados importantes

- **Máquina "ociosa":** na conta gratuita, a Oracle pode parar máquinas que passam 7 dias com uso de
  processador, rede e memória abaixo de 20%, e um chat de escritório usa pouco. Segundo a Oracle,
  converter a conta para **Pay As You Go** evita isso, e as máquinas continuam sem custo enquanto
  ficarem dentro dos limites gratuitos. Ao converter, crie um **alerta de orçamento** (Billing →
  Budgets) de valor baixo para ser avisado de qualquer cobrança.
- **Dados de clientes:** as conversas e arquivos passam a ficar num servidor da Oracle (em São Paulo).
  Vale alinhar com o responsável pela LGPD do escritório.
- **Senhas:** o chat fica acessível pela internet. Exija senhas fortes e desative quem sair da empresa.
- **Atualizações do Ubuntu:** as de segurança são instaladas sozinhas; uma vez por mês rode
  `sudo apt update && sudo apt upgrade -y`.
