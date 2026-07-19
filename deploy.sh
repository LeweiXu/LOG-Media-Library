#!/usr/bin/env bash
# Sync the Logarium backend, apply migrations, and restart its user service.
set -euo pipefail

SERVER="${LOGARIUM_SERVER:-lingwei@192.168.20.9}"
DEST="LOG_Project/"
SERVICE="logarium-api"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Syncing backend to $SERVER:~/$DEST"
rsync -avz --delete \
  --exclude-from="$HERE/deploy-exclude.txt" \
  "$HERE/backend/" "$SERVER:$DEST"

echo "Installing the $SERVICE user service"
ssh "$SERVER" 'mkdir -p "$HOME/.config/systemd/user"'
rsync -avz "$HERE/logarium-api.service" \
  "$SERVER:.config/systemd/user/$SERVICE.service"

echo "Checking the backend and applying database migrations"
ssh "$SERVER" bash -s -- "$DEST" "$SERVICE" <<'REMOTE'
set -euo pipefail
dest="$1"
service="$2"
cd "$HOME/$dest"
"$HOME/venv-LOG/bin/python" -m compileall -q .
"$HOME/venv-LOG/bin/python" -m alembic upgrade head
chmod 600 .env
systemctl --user daemon-reload
systemctl --user enable "$service" >/dev/null
systemctl --user restart "$service"
systemctl --user is-active "$service"
for _ in {1..20}; do
  if curl --fail --silent http://127.0.0.1:8001/ >/dev/null; then
    exit 0
  fi
  sleep 0.5
done
systemctl --user status "$service" --no-pager -n 30
echo "The API did not pass its health check." >&2
exit 1
REMOTE

echo "Done."
