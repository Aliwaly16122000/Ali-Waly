#!/usr/bin/env bash
# Pull the latest version and restart — data is kept. Usage: sudo bash /opt/engportal/src/deploy/update.sh
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/engportal}"
# shellcheck disable=SC1091
. "$APP_DIR/deploy.env"
BRANCH="${BRANCH:-main}"
echo "💾 نسخة احتياطية قبل التحديث…"
mkdir -p "$APP_DIR/data/backups"
cp "$APP_DIR/data/engportal.db" "$APP_DIR/data/backups/before-update-$(date +%F-%H%M).db" 2>/dev/null || true
echo "⬇️  تحميل آخر نسخة ($BRANCH)…"
git -C "$APP_DIR/src" fetch -q origin "$BRANCH"
git -C "$APP_DIR/src" checkout -q -B "$BRANCH" "origin/$BRANCH"
echo "🔄 إعادة التشغيل…"
docker compose -f "$APP_DIR/docker-compose.yml" --project-directory "$APP_DIR" up -d --build
for _ in $(seq 1 60); do curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1 && { echo "✅ تم التحديث"; exit 0; }; sleep 3; done
echo "⚠️  التطبيق لسه بيقوم — راجع: docker compose -f $APP_DIR/docker-compose.yml logs --tail 50"
