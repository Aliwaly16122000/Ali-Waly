#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  EngPortal — one-command install on a fresh Ubuntu server (e.g. Oracle Cloud
#  "Always Free"). Installs Docker + Caddy (automatic HTTPS), opens the firewall,
#  pulls the app from GitHub and starts it.
#
#    curl -fsSL https://raw.githubusercontent.com/Aliwaly16122000/Ali-Waly/main/deploy/install.sh | sudo bash
#
#  Re-running it is safe: it updates the code and keeps all data.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="${REPO:-https://github.com/Aliwaly16122000/Ali-Waly.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/engportal}"
CONF="$APP_DIR/deploy.env"

green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$*"; }
red() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }
ask() { # ask VAR "question" [default] — reads from the terminal even when piped from curl
  local var="$1" q="$2" def="${3:-}" ans
  if [ -n "${!var:-}" ]; then return; fi
  if [ -n "$def" ]; then q="$q [$def]"; fi
  read -r -p "$q: " ans </dev/tty || true
  printf -v "$var" '%s' "${ans:-$def}"
}

[ "$(id -u)" -eq 0 ] || { red "شغّل السكريبت بـ sudo"; exit 1; }
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || yellow "تنبيه: السكريبت متجرب على Ubuntu 22.04/24.04 — نظامك: ${PRETTY_NAME:-غير معروف}"

mkdir -p "$APP_DIR"
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"

green "══ إعداد بوابة الكلية ══"
ask DOMAIN "اسم الموقع (مثال: psu-eng.duckdns.org)"
[ -n "${DOMAIN:-}" ] || { red "لازم تكتب اسم الموقع"; exit 1; }
ask DUCKDNS_TOKEN "توكن DuckDNS (اختياري — Enter للتخطي)" ""
ask ADMIN_USERNAME "اسم مستخدم الأدمن" "admin"
if [ -z "${ADMIN_PASSWORD:-}" ]; then
  while :; do
    read -r -s -p "كلمة سر الأدمن (8 حروف على الأقل): " ADMIN_PASSWORD </dev/tty; echo
    if [ "${#ADMIN_PASSWORD}" -lt 8 ]; then red "كلمة السر قصيرة"; continue; fi
    case "$ADMIN_PASSWORD" in *"'"*|*'"'*|*' '*) red "كلمة السر متحتويش على مسافات أو علامات تنصيص"; continue ;; esac
    break
  done
fi
ask CONTACT_EMAIL "إيميلك (لشهادة HTTPS والإشعارات)" "admin@${DOMAIN}"

umask 077
cat > "$CONF" <<CONFEOF
DOMAIN='$DOMAIN'
DUCKDNS_TOKEN='$DUCKDNS_TOKEN'
ADMIN_USERNAME='$ADMIN_USERNAME'
ADMIN_PASSWORD='$ADMIN_PASSWORD'
CONTACT_EMAIL='$CONTACT_EMAIL'
BRANCH='$BRANCH'
CONFEOF
umask 022

# Small servers (e.g. Oracle's 1 GB "Micro") need swap to build the web app.
mem_mb=$(awk '/MemTotal/ { print int($2/1024) }' /proc/meminfo)
if [ "$mem_mb" -lt 3000 ] && ! swapon --show | grep -q .; then
  yellow "الذاكرة ${mem_mb}MB — هعمل swap بـ 2GB عشان البناء يكمل"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

green "① تثبيت الأدوات (Docker, Caddy, Git)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent >/dev/null
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

green "② فتح بورت 80 و 443 في الجدار الناري…"
# Oracle's Ubuntu images ship an iptables REJECT rule; allow web traffic before it.
for port in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    reject_line=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')
    if [ -n "$reject_line" ]; then
      iptables -I INPUT "$reject_line" -p tcp --dport "$port" -m state --state NEW -j ACCEPT
    else
      iptables -A INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT
    fi
  fi
done
netfilter-persistent save >/dev/null 2>&1 || true
command -v ufw >/dev/null && ufw status | grep -q active && { ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; }

if [ -n "$DUCKDNS_TOKEN" ] && [[ "$DOMAIN" == *.duckdns.org ]]; then
  green "③ ربط الدومين بـ IP السيرفر (DuckDNS)…"
  SUB="${DOMAIN%.duckdns.org}"
  echo "*/10 * * * * root curl -fsS 'https://www.duckdns.org/update?domains=$SUB&token=$DUCKDNS_TOKEN&ip=' >/dev/null 2>&1" > /etc/cron.d/duckdns
  chmod 600 /etc/cron.d/duckdns
  curl -fsS "https://www.duckdns.org/update?domains=$SUB&token=$DUCKDNS_TOKEN&ip=" && echo
fi

green "④ تحميل التطبيق…"
if [ -d "$APP_DIR/src/.git" ]; then
  git -C "$APP_DIR/src" fetch -q origin "$BRANCH" && git -C "$APP_DIR/src" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR/src"
fi

cat > "$APP_DIR/docker-compose.yml" <<COMPOSEEOF
services:
  engportal:
    build: ./src
    restart: unless-stopped
    ports:
      - "127.0.0.1:4000:4000"
    environment:
      ADMIN_USERNAME: "\${ADMIN_USERNAME}"
      ADMIN_PASSWORD: "\${ADMIN_PASSWORD}"
      APP_TIMEZONE: Africa/Cairo
      PUSH_SUBJECT: "mailto:\${CONTACT_EMAIL}"
    volumes:
      - ./data:/data
COMPOSEEOF
ln -sf "$CONF" "$APP_DIR/.env"

green "⑤ تشغيل التطبيق (أول مرة بتاخد 3-5 دقايق)…"
docker compose -f "$APP_DIR/docker-compose.yml" --project-directory "$APP_DIR" up -d --build

green "⑥ إعداد HTTPS…"
cat > /etc/caddy/Caddyfile <<CADDYEOF
{
  email $CONTACT_EMAIL
}

$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:4000
  request_body {
    max_size 25MB
  }
}
CADDYEOF
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo -n "في انتظار التطبيق"
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1 && break
  echo -n "."; sleep 3
done
echo

# Keep the Docker image store tidy (old builds pile up after updates).
cat > /etc/cron.d/engportal <<CRONEOF
30 4 * * 5 root docker image prune -f >/dev/null 2>&1
CRONEOF

if curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
  green "✅ التطبيق شغال!"
  echo
  echo "   افتح:            https://$DOMAIN"
  echo "   اسم المستخدم:    $ADMIN_USERNAME"
  echo "   كلمة السر:       (اللي كتبتها — هيطلب منك تغيّرها أول دخول)"
  echo
  echo "   تحديث التطبيق لاحقاً:   sudo bash $APP_DIR/src/deploy/update.sh"
  echo "   البيانات والنسخ الاحتياطية في:  $APP_DIR/data"
  yellow "   لو اللينك مفتحش: اتأكد إنك فتحت بورت 80 و443 في Oracle (Security List) وإن الدومين بيشاور على IP السيرفر."
else
  red "التطبيق لسه مش شغال. شوف السبب بالأمر:"
  echo "   sudo docker compose -f $APP_DIR/docker-compose.yml logs --tail 50"
  exit 1
fi
