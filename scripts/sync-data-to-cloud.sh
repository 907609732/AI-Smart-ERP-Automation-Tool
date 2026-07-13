#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REMOTE_HOST="${REMOTE_HOST:-aliyun-erp}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/www/wwwroot/AI-Smart-ERP-Automation-Tool}"
REMOTE_HEALTH_URL="${REMOTE_HEALTH_URL:-https://erp.lttlt.top/api/health}"
REMOTE_BACKUP_ROOT="${REMOTE_BACKUP_ROOT:-/www/backup/ai-smart-erp}"
INCLUDE_REPORTS="${INCLUDE_REPORTS:-0}"
SYNC_DINGTALK_ENV="${SYNC_DINGTALK_ENV:-1}"

STAMP="$(date +%Y%m%d-%H%M%S)"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ai-smart-erp-sync-${STAMP}.XXXXXX")"
REMOTE_STAGE="/tmp/ai-smart-erp-sync-${STAMP}"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令：$1"
    exit 1
  fi
}

sql_literal() {
  printf "%s" "$1" | sed "s/'/''/g"
}

read_env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 1
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*" key "=" {
      sub("^[[:space:]]*" key "=", "")
      sub("\r$", "")
      print
      found=1
      exit
    }
    END { if (!found) exit 1 }
  ' "$file"
}

write_optional_env_update() {
  [[ "$SYNC_DINGTALK_ENV" == "1" ]] || return 0
  local output="$STAGING_DIR/env.production.update"
  : > "$output"

  local value
  for key in DINGTALK_WEBHOOK DINGTALK_SECRET LOW_STOCK_THRESHOLD; do
    if value="$(read_env_value "$key" "$ROOT_DIR/.env.local" 2>/dev/null)"; then
      printf "%s=%s\n" "$key" "$value" >> "$output"
    fi
  done

  if [[ ! -s "$output" ]]; then
    rm -f "$output"
  else
    chmod 600 "$output"
  fi
}

require_command sqlite3
require_command rsync
require_command ssh

if [[ ! -f "$ROOT_DIR/data/erp.sqlite" ]]; then
  echo "本地缺少 data/erp.sqlite，无法同步。"
  exit 1
fi

echo "准备本地一致性快照..."
mkdir -p "$STAGING_DIR/data"
sqlite3 "$ROOT_DIR/data/erp.sqlite" ".backup '$STAGING_DIR/data/erp.sqlite'"

local_root_sql="$(sql_literal "$ROOT_DIR")"
remote_root_sql="$(sql_literal "$REMOTE_APP_DIR")"
sqlite3 "$STAGING_DIR/data/erp.sqlite" <<SQL
PRAGMA foreign_keys = ON;
UPDATE imported_files
   SET stored_path = replace(stored_path, '$local_root_sql', '$remote_root_sql')
 WHERE instr(stored_path, '$local_root_sql') > 0;
UPDATE product_images
   SET stored_path = replace(stored_path, '$local_root_sql', '$remote_root_sql')
 WHERE instr(stored_path, '$local_root_sql') > 0;
VACUUM;
SQL

for dir in data/imported-files data/product-images uploads; do
  if [[ -e "$ROOT_DIR/$dir" ]]; then
    mkdir -p "$STAGING_DIR/$(dirname "$dir")"
    rsync -a --delete "$ROOT_DIR/$dir/" "$STAGING_DIR/$dir/"
  fi
done

if [[ "$INCLUDE_REPORTS" == "1" && -e "$ROOT_DIR/reports" ]]; then
  mkdir -p "$STAGING_DIR/reports"
  rsync -a --delete "$ROOT_DIR/reports/" "$STAGING_DIR/reports/"
fi

write_optional_env_update

echo "上传业务数据到云端临时目录..."
ssh "$REMOTE_HOST" "rm -rf '$REMOTE_STAGE' && mkdir -p '$REMOTE_STAGE'"
rsync -az --delete "$STAGING_DIR/" "$REMOTE_HOST:$REMOTE_STAGE/"

echo "云端备份并恢复业务数据..."
ssh "$REMOTE_HOST" "REMOTE_STAGE='$REMOTE_STAGE' REMOTE_APP_DIR='$REMOTE_APP_DIR' REMOTE_BACKUP_ROOT='$REMOTE_BACKUP_ROOT' INCLUDE_REPORTS='$INCLUDE_REPORTS' bash -s" <<'REMOTE'
set -euo pipefail

cd "$REMOTE_APP_DIR"

restart_container() {
  docker compose -p ai-smart-erp up -d erp >/dev/null 2>&1 || true
}
trap restart_container EXIT

echo "创建云端恢复前备份..."
BACKUP_ROOT="$REMOTE_BACKUP_ROOT" ./scripts/backup.sh

echo "停止 ERP 容器..."
docker compose -p ai-smart-erp stop erp

mkdir -p data uploads downloads reports state logs
rm -f data/erp.sqlite data/erp.sqlite-shm data/erp.sqlite-wal
cp "$REMOTE_STAGE/data/erp.sqlite" data/erp.sqlite

rm -rf data/imported-files data/product-images uploads
mkdir -p data/imported-files data/product-images uploads
if [[ -d "$REMOTE_STAGE/data/imported-files" ]]; then
  cp -a "$REMOTE_STAGE/data/imported-files/." data/imported-files/
fi
if [[ -d "$REMOTE_STAGE/data/product-images" ]]; then
  cp -a "$REMOTE_STAGE/data/product-images/." data/product-images/
fi
if [[ -d "$REMOTE_STAGE/uploads" ]]; then
  cp -a "$REMOTE_STAGE/uploads/." uploads/
fi

if [[ "$INCLUDE_REPORTS" == "1" && -d "$REMOTE_STAGE/reports" ]]; then
  rm -rf reports
  mkdir -p reports
  cp -a "$REMOTE_STAGE/reports/." reports/
fi

if [[ -s "$REMOTE_STAGE/env.production.update" ]]; then
  echo "更新云端钉钉配置..."
  touch .env.production
  env_backup_dir="$REMOTE_BACKUP_ROOT/env-production-backups"
  mkdir -p "$env_backup_dir"
  cp .env.production "$env_backup_dir/.env.production.$(date +%Y%m%d-%H%M%S)"
  chmod 600 "$env_backup_dir"/.env.production.*
  python3 - "$REMOTE_STAGE/env.production.update" .env.production <<'PY'
import sys
from pathlib import Path

update_path = Path(sys.argv[1])
target_path = Path(sys.argv[2])
updates = {}
for raw in update_path.read_text().splitlines():
    if not raw or raw.lstrip().startswith("#") or "=" not in raw:
        continue
    key = raw.split("=", 1)[0].strip()
    updates[key] = raw

lines = target_path.read_text().splitlines() if target_path.exists() else []
seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
    if key in updates:
        out.append(updates[key])
        seen.add(key)
    else:
        out.append(line)
for key, line in updates.items():
    if key not in seen:
        out.append(line)
target_path.write_text("\n".join(out) + "\n")
PY
  chmod 600 .env.production
fi

echo "启动 ERP 容器..."
docker compose -p ai-smart-erp up -d erp

echo "等待云端健康检查..."
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
    rm -rf "$REMOTE_STAGE"
    trap - EXIT
    exit 0
  fi
  sleep 2
done

echo "云端健康检查失败，最近日志："
docker compose -p ai-smart-erp logs --tail=80 erp
exit 1
REMOTE

echo "验证公网 HTTPS..."
curl --noproxy '*' -fsS "$REMOTE_HEALTH_URL" >/dev/null
echo "同步完成：$REMOTE_HEALTH_URL 正常。"
