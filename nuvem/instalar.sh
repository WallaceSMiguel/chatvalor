#!/usr/bin/env bash
# =====================================================================
#  Valorização Chat — instalação na nuvem (Ubuntu 22.04 / 24.04)
#  Testado para a máquina gratuita "Always Free" do Oracle Cloud.
#
#  Uso (dentro da pasta valorizacao-chat copiada para o servidor):
#     sudo bash nuvem/instalar.sh chat.suaempresa.com.br  seu-email@empresa.com.br
#
#  O que faz:
#   - instala Python, o servidor web Caddy (HTTPS com certificado válido e gratuito)
#   - copia o chat para /opt/valorizacao-chat e cria o serviço que liga sozinho
#   - libera as portas 80 e 443 no firewall da máquina
#   - agenda backup diário do banco e dos arquivos (guarda 14 dias)
#   - na primeira instalação, traz junto chat.db e uploads/ se estiverem na pasta copiada
#  Rodar de novo = atualizar o código. Os dados (mensagens, áudios, fotos) nunca são apagados.
# =====================================================================
set -euo pipefail

DOMINIO="${1:-}"
EMAIL="${2:-}"
DESTINO="/opt/valorizacao-chat"
USUARIO="chatvalorizacao"
PORTA_INTERNA="5080"
ORIGEM="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

verde() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m[aviso]\033[0m %s\n' "$*"; }
erro()  { printf '\033[1;31m[erro]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || erro "Rode com sudo:  sudo bash nuvem/instalar.sh $DOMINIO $EMAIL"
[ -n "$DOMINIO" ] || erro "Informe o endereço do chat. Ex.: sudo bash nuvem/instalar.sh chat.suaempresa.com.br voce@empresa.com.br"
[ -f "$ORIGEM/app.py" ] || erro "Não encontrei app.py em $ORIGEM. Rode o script de dentro da pasta valorizacao-chat."
if [[ ! "$DOMINIO" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  erro "Endereço inválido: '$DOMINIO'. Use só o nome, sem https:// (ex.: chat.suaempresa.com.br)."
fi

# ---------------------------------------------------------------- 1. pacotes
verde "1/7  Instalando Python e utilitários"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q python3 python3-venv python3-pip sqlite3 rsync curl gnupg ca-certificates

# ---------------------------------------------------------------- 2. Caddy
verde "2/7  Instalando o servidor web Caddy (HTTPS automático)"
if ! command -v caddy >/dev/null 2>&1; then
  if curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
     && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        > /etc/apt/sources.list.d/caddy-stable.list; then
    apt-get update -q
  else
    aviso "Repositório oficial do Caddy indisponível; usando o pacote do Ubuntu."
    rm -f /etc/apt/sources.list.d/caddy-stable.list
  fi
  apt-get install -y -q caddy
fi
caddy version || erro "O Caddy não foi instalado."

# ---------------------------------------------------------------- 3. código e dados
verde "3/7  Copiando o chat para $DESTINO"
id "$USUARIO" >/dev/null 2>&1 || useradd --system --home "$DESTINO" --shell /usr/sbin/nologin "$USUARIO"
mkdir -p "$DESTINO"
PRIMEIRA_VEZ=0
[ -f "$DESTINO/chat.db" ] || PRIMEIRA_VEZ=1
# código: sempre atualizado; dados: nunca sobrescritos
rsync -a --delete \
  --exclude '.venv/' --exclude 'certificado/' --exclude '__pycache__/' \
  --exclude 'chat.db' --exclude 'chat.db-*' --exclude 'uploads/' --exclude '.secret_key' \
  --exclude 'backups/' --exclude 'iniciar.bat' \
  "$ORIGEM/" "$DESTINO/"
mkdir -p "$DESTINO/uploads/fotos" "$DESTINO/backups"
if [ "$PRIMEIRA_VEZ" -eq 1 ] && [ -f "$ORIGEM/chat.db" ]; then
  verde "      Trazendo as mensagens e arquivos que vieram na pasta (chat.db e uploads/)"
  sqlite3 "$ORIGEM/chat.db" ".backup '$DESTINO/chat.db'"
  [ -d "$ORIGEM/uploads" ] && rsync -a "$ORIGEM/uploads/" "$DESTINO/uploads/"
  [ -f "$ORIGEM/.secret_key" ] && cp "$ORIGEM/.secret_key" "$DESTINO/.secret_key"
fi
chown -R "$USUARIO:$USUARIO" "$DESTINO"
chmod 750 "$DESTINO"

# ---------------------------------------------------------------- 4. ambiente Python
verde "4/7  Instalando as bibliotecas do chat"
sudo -u "$USUARIO" python3 -m venv "$DESTINO/.venv"
sudo -u "$USUARIO" "$DESTINO/.venv/bin/pip" install -q --disable-pip-version-check --upgrade pip
sudo -u "$USUARIO" "$DESTINO/.venv/bin/pip" install -q --disable-pip-version-check -r "$DESTINO/requirements.txt"

# ---------------------------------------------------------------- 5. serviço
verde "5/7  Criando o serviço que mantém o chat ligado"
cat > /etc/systemd/system/valorizacao-chat.service <<EOF
[Unit]
Description=Valorização Chat
After=network-online.target
Wants=network-online.target

[Service]
User=$USUARIO
Group=$USUARIO
WorkingDirectory=$DESTINO
Environment=PROXY=1
Environment=HOST=127.0.0.1
Environment=PORTA=$PORTA_INTERNA
Environment=PYTHONUNBUFFERED=1
ExecStart=$DESTINO/.venv/bin/python app.py
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DESTINO

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable valorizacao-chat >/dev/null
systemctl restart valorizacao-chat

# ---------------------------------------------------------------- 6. HTTPS e firewall
verde "6/7  Configurando o HTTPS para $DOMINIO e liberando as portas 80/443"
{
  echo "# Gerado por nuvem/instalar.sh — Valorização Chat"
  if [ -n "$EMAIL" ]; then printf '{\n\temail %s\n}\n\n' "$EMAIL"; fi
  cat <<EOF
$DOMINIO {
	encode gzip
	request_body {
		max_size 30MB
	}
	reverse_proxy 127.0.0.1:$PORTA_INTERNA
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		-Server
	}
}
EOF
} > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null
systemctl restart caddy

# As imagens Ubuntu do Oracle Cloud trazem regras de iptables que bloqueiam tudo além do SSH.
for porta in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$porta" -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null; then
    iptables -I INPUT 1 -p tcp --dport "$porta" -m conntrack --ctstate NEW -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save >/dev/null 2>&1 || true
else
  apt-get install -y -q iptables-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || \
    aviso "Não consegui salvar as regras de firewall; após reiniciar a máquina, rode este script de novo."
fi
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

# ---------------------------------------------------------------- 7. backup diário
verde "7/7  Agendando o backup diário (guarda 14 dias em $DESTINO/backups)"
cat > /etc/cron.daily/valorizacao-chat-backup <<EOF
#!/bin/sh
# Backup diário do Valorização Chat: banco (cópia consistente) + arquivos enviados
set -e
D=$DESTINO
DIA=\$(date +%Y-%m-%d)
sqlite3 "\$D/chat.db" ".backup '\$D/backups/chat-\$DIA.db'"
tar -czf "\$D/backups/uploads-\$DIA.tar.gz" -C "\$D" uploads
chown $USUARIO:$USUARIO "\$D/backups/"*
find "\$D/backups" -type f -mtime +14 -delete
EOF
chmod 755 /etc/cron.daily/valorizacao-chat-backup

# ---------------------------------------------------------------- conferência
sleep 3
if systemctl is-active --quiet valorizacao-chat && curl -fsS -o /dev/null "http://127.0.0.1:$PORTA_INTERNA/login"; then
  verde "Chat ligado."
else
  aviso "O chat não respondeu. Veja o motivo com:  sudo journalctl -u valorizacao-chat -n 50"
fi
IP_PUBLICO="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo 'IP-DESTA-MAQUINA')"
cat <<EOF

----------------------------------------------------------------------
  Pronto! Acesse:  https://$DOMINIO

  - O certificado HTTPS é emitido sozinho na primeira visita (pode levar 1 minuto).
    Para isso o endereço $DOMINIO precisa apontar para o IP $IP_PUBLICO
    e as portas 80 e 443 precisam estar liberadas também no painel da nuvem.
  - Primeiro acesso (se o banco é novo): admin / admin123 — troque a senha na hora.
  - Ver o funcionamento:   sudo systemctl status valorizacao-chat
  - Ver os registros:      sudo journalctl -u valorizacao-chat -f
  - Atualizar o chat:      copie a pasta nova e rode este script de novo
  - Backups diários em:    $DESTINO/backups
----------------------------------------------------------------------
EOF
