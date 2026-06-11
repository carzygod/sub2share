#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage:
  deploy-production.sh --archive /tmp/sub2share-user-<commit>.tar --commit <short-sha> [options]

Options:
  --base <path>        Release base directory. Default: /opt/zhisuan-yizhan
  --api-port <port>   API port. Default: 4100
  --web-port <port>   Web preview port. Default: 3100
  --admin-port <port> Admin preview port. Default: 3101
  --keep-archive      Do not remove the uploaded archive after a successful deploy.
  -h, --help          Show this help.

The archive should contain the repository user/ subtree contents at its root,
for example: git archive HEAD:user --output=/tmp/sub2share-user-<commit>.tar
USAGE
}

archive=""
commit=""
base="/opt/zhisuan-yizhan"
api_port="4100"
web_port="3100"
admin_port="3101"
keep_archive="false"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --archive)
      archive="${2:-}"
      shift 2
      ;;
    --commit)
      commit="${2:-}"
      shift 2
      ;;
    --base)
      base="${2:-}"
      shift 2
      ;;
    --api-port)
      api_port="${2:-}"
      shift 2
      ;;
    --web-port)
      web_port="${2:-}"
      shift 2
      ;;
    --admin-port)
      admin_port="${2:-}"
      shift 2
      ;;
    --keep-archive)
      keep_archive="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$archive" ] || [ -z "$commit" ]; then
  usage >&2
  exit 2
fi
if [ ! -f "$archive" ]; then
  echo "Archive not found: $archive" >&2
  exit 1
fi

export PNPM_HOME="${PNPM_HOME:-/root/.local/share/pnpm}"
export PATH="$PNPM_HOME:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
current="$base/user"
staging="$base/user.new-$stamp-$commit"
replaced="$base/user-replaced-$stamp-$commit"

log() {
  printf '[deploy:%s] %s\n' "$commit" "$*"
}

systemd_available() {
  command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]
}

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

source_release_env() {
  local root="$1"
  if [ -f "$root/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$root/.env"
    set +a
  fi
  export NODE_ENV=production
  export VITE_API_BASE="${API_PUBLIC_URL:-http://127.0.0.1:${api_port}}"
}

port_pids() {
  local port="$1"
  fuser "${port}/tcp" 2>/dev/null || true
}

stop_port() {
  local port="$1"
  local pids=""

  for _attempt in 1 2 3 4 5 6 7 8; do
    pids="$(port_pids "$port")"
    if [ -z "$pids" ]; then
      return 0
    fi
    kill -TERM $pids 2>/dev/null || true
    sleep 1
  done

  for _attempt in 1 2 3 4 5; do
    pids="$(port_pids "$port")"
    if [ -z "$pids" ]; then
      return 0
    fi
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
    sleep 1
  done

  pids="$(port_pids "$port")"
  if [ -n "$pids" ]; then
    echo "Port $port is still busy after stop attempts: $pids" >&2
    return 1
  fi
}

stop_ports() {
  log "stopping ports $api_port, $web_port, $admin_port"
  stop_systemd_services
  stop_port "$api_port"
  stop_port "$web_port"
  stop_port "$admin_port"
  stop_legacy_preview_processes
}

stop_systemd_services() {
  if ! systemd_available; then
    return 0
  fi
  systemctl stop zyz-api.service zyz-web.service zyz-admin.service 2>/dev/null || true
  systemctl reset-failed zyz-api.service zyz-web.service zyz-admin.service 2>/dev/null || true
}

stop_legacy_preview_processes() {
  pkill -TERM -f "vite preview --host 0.0.0.0 --port ${web_port}" 2>/dev/null || true
  pkill -TERM -f "vite preview --host 0.0.0.0 --port ${admin_port}" 2>/dev/null || true
  pkill -TERM -f "pnpm .*@zyz/web.*--port ${web_port}" 2>/dev/null || true
  pkill -TERM -f "pnpm .*@zyz/admin.*--port ${admin_port}" 2>/dev/null || true
}

start_services() {
  log "starting services from $current"
  cd "$current"
  source_release_env "$current"
  mkdir -p "$current/logs"

  if systemd_available; then
    install_systemd_units
    systemctl daemon-reload
    systemctl enable zyz-api.service zyz-web.service zyz-admin.service >/dev/null
    systemctl restart zyz-api.service zyz-web.service zyz-admin.service
    return 0
  fi

  ( cd -P "$current/apps/api" && nohup node dist/main.js > "$current/logs/api.log" 2>&1 & )
  ( cd -P "$current" && nohup node scripts/serve-static.mjs apps/web/dist "$web_port" > "$current/logs/web.log" 2>&1 & )
  ( cd -P "$current" && nohup node scripts/serve-static.mjs apps/admin/dist "$admin_port" > "$current/logs/admin.log" 2>&1 & )
}

install_systemd_units() {
  local node_bin
  node_bin="$(command -v node)"

  cat > /etc/systemd/system/zyz-api.service <<UNIT
[Unit]
Description=Zhisuan Yizhan User API
After=network.target

[Service]
Type=simple
WorkingDirectory=$current/apps/api
EnvironmentFile=-$current/.env
Environment=NODE_ENV=production
ExecStart=$node_bin dist/main.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

  cat > /etc/systemd/system/zyz-web.service <<UNIT
[Unit]
Description=Zhisuan Yizhan Web
After=network.target

[Service]
Type=simple
WorkingDirectory=$current
Environment=NODE_ENV=production
ExecStart=$node_bin scripts/serve-static.mjs apps/web/dist $web_port
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

  cat > /etc/systemd/system/zyz-admin.service <<UNIT
[Unit]
Description=Zhisuan Yizhan Admin
After=network.target

[Service]
Type=simple
WorkingDirectory=$current
Environment=NODE_ENV=production
ExecStart=$node_bin scripts/serve-static.mjs apps/admin/dist $admin_port
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
}

wait_http() {
  local url="$1"
  local code=""
  for _attempt in $(seq 1 40); do
    code="$(curl -fsS -o /dev/null -w '%{http_code}' "$url" || true)"
    if [ "$code" = "200" ]; then
      log "$url -> 200"
      return 0
    fi
    sleep 1
  done
  echo "Health check failed for $url, last_code=${code:-none}" >&2
  tail -n 80 "$current/logs/api.log" 2>/dev/null || true
  tail -n 80 "$current/logs/web.log" 2>/dev/null || true
  tail -n 80 "$current/logs/admin.log" 2>/dev/null || true
  return 1
}

port_cwd() {
  local port="$1"
  local pid=""
  pid="$(port_pids "$port" | awk '{print $1}')"
  if [ -z "$pid" ]; then
    echo ""
    return 1
  fi
  readlink -f "/proc/$pid/cwd"
}

verify_port_cwd() {
  local port="$1"
  local cwd=""
  cwd="$(port_cwd "$port")"
  if [ -z "$cwd" ]; then
    echo "No listener pid found for port $port" >&2
    return 1
  fi
  log "port $port cwd $cwd"
  case "$cwd" in
    *user-replaced-*|*user.new-*)
      echo "Port $port is running from stale or staging cwd: $cwd" >&2
      return 1
      ;;
  esac
  case "$cwd" in
    "$current"|"$current"/*) ;;
    *)
      echo "Port $port is running from unexpected cwd: $cwd" >&2
      return 1
      ;;
  esac
}

verify_runtime() {
  wait_http "http://127.0.0.1:${api_port}/health"
  wait_http "http://127.0.0.1:${api_port}/ready"
  wait_http "http://127.0.0.1:${web_port}/"
  wait_http "http://127.0.0.1:${admin_port}/"
  if ! verify_all_port_cwds; then
    log "stale listener detected after start; restarting current release once"
    stop_ports
    start_services
    wait_http "http://127.0.0.1:${api_port}/health"
    wait_http "http://127.0.0.1:${api_port}/ready"
    wait_http "http://127.0.0.1:${web_port}/"
    wait_http "http://127.0.0.1:${admin_port}/"
    verify_all_port_cwds
  fi
}

verify_all_port_cwds() {
  local failed=0
  verify_port_cwd "$api_port" || failed=1
  verify_port_cwd "$web_port" || failed=1
  verify_port_cwd "$admin_port" || failed=1
  return "$failed"
}

log "creating staging release $staging"
rm -rf -- "$staging"
mkdir -p "$staging"
tar -xf "$archive" -C "$staging"
if [ -f "$current/.env" ]; then
  cp "$current/.env" "$staging/.env"
fi

upsert_env "$staging/.env" "SUB2_USAGE_SYNC_INTERVAL_MS" "300000"
upsert_env "$staging/.env" "SUB2_USAGE_SYNC_ON_START" "true"

cd "$staging"
source_release_env "$staging"

log "installing dependencies"
pnpm install --frozen-lockfile --prod=false
log "generating Prisma client"
pnpm db:generate
log "applying database migrations"
pnpm exec prisma migrate deploy
log "running type checks and API tests"
pnpm --filter @zyz/shared run build
pnpm --filter @zyz/api run typecheck
pnpm --filter @zyz/admin run typecheck
pnpm --filter @zyz/api test
pnpm --filter @zyz/admin test
log "building workspace"
pnpm build
mkdir -p logs

stop_ports

log "switching release directories"
if [ -d "$current" ]; then
  mv "$current" "$replaced"
fi
mv "$staging" "$current"
printf 'commit=%s\ndeployed_at=%s\n' "$commit" "$stamp" > "$current/.release-marker"

start_services
verify_runtime

if [ "$keep_archive" != "true" ]; then
  rm -f -- "$archive"
fi

log "deployed $commit at $stamp"
