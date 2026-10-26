#!/usr/bin/env bash
# =====================================================================
#  Valorização Chat — trazer as mensagens do servidor do escritório para a nuvem
#
#  1. No servidor do escritório, feche o chat e copie para a nuvem o arquivo
#     chat.db e a pasta uploads (ex.: com o WinSCP, para /home/ubuntu/dados).
#  2. Na nuvem:   sudo bash nuvem/importar-dados.sh /home/ubuntu/dados
#
#  O que estiver hoje na nuvem é guardado antes em /opt/valorizacao-chat/backups.
# =====================================================================
set -euo pipefail
ORIGEM="${1:-}"
DESTINO="/opt/valorizacao-chat"
USUARIO="chatvalorizacao"

[ "$(id -u)" -eq 0 ] || { echo "Rode com sudo."; exit 1; }
[ -n "$ORIGEM" ] && [ -f "$ORIGEM/chat.db" ] || { echo "Informe a pasta que contém chat.db (e uploads/). Ex.: sudo bash nuvem/importar-dados.sh /home/ubuntu/dados"; exit 1; }
[ -d "$DESTINO" ] || { echo "O chat ainda não foi instalado. Rode antes: sudo bash nuvem/instalar.sh SEU-ENDERECO"; exit 1; }

sqlite3 "$ORIGEM/chat.db" "PRAGMA integrity_check;" | grep -q '^ok$' || { echo "O chat.db copiado está danificado. Copie de novo com o chat fechado."; exit 1; }

systemctl stop valorizacao-chat
AGORA="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DESTINO/backups"
if [ -f "$DESTINO/chat.db" ]; then
  sqlite3 "$DESTINO/chat.db" ".backup '$DESTINO/backups/antes-da-importacao-$AGORA.db'"
  tar -czf "$DESTINO/backups/uploads-antes-da-importacao-$AGORA.tar.gz" -C "$DESTINO" uploads 2>/dev/null || true
fi
rm -f "$DESTINO/chat.db" "$DESTINO"/chat.db-wal "$DESTINO"/chat.db-shm
sqlite3 "$ORIGEM/chat.db" ".backup '$DESTINO/chat.db'"
if [ -d "$ORIGEM/uploads" ]; then
  rsync -a "$ORIGEM/uploads/" "$DESTINO/uploads/"
fi
[ -f "$ORIGEM/.secret_key" ] && cp "$ORIGEM/.secret_key" "$DESTINO/.secret_key"
chown -R "$USUARIO:$USUARIO" "$DESTINO"
systemctl start valorizacao-chat
sleep 2
systemctl is-active --quiet valorizacao-chat && echo "Importação concluída. Mensagens, usuários, áudios e fotos já estão na nuvem." \
  || echo "O chat não subiu. Veja: sudo journalctl -u valorizacao-chat -n 50"
