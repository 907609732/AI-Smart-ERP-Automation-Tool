#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# launchd inherits desktop proxy variables. Direct access is available here,
# and clearing them prevents a stopped local proxy from blocking the schedule.
unset http_proxy https_proxy all_proxy socks_proxy
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY SOCKS_PROXY

export BUSINESS_TIME_ZONE="${BUSINESS_TIME_ZONE:-Asia/Shanghai}"
TODAY="$(TZ="$BUSINESS_TIME_ZONE" date +%F)"

if [[ "${ENFORCE_SCHEDULE_HOUR:-0}" == "1" ]]; then
  business_hour="$(TZ="$BUSINESS_TIME_ZONE" date +%H)"
  if [[ "$business_hour" != "22" ]]; then
    echo "[$(date '+%F %T %Z')] 非中国时间 22:00，跳过本次定时检查。"
    exit 0
  fi
fi

echo "[$(date '+%F %T %Z')] 开始菜鸟库存采集，业务日期：$TODAY"
npm run sync:inventory:full

snapshot_date="$(sqlite3 data/erp.sqlite "SELECT COALESCE(MAX(snapshot_date), '') FROM inventory_snapshots WHERE warehouse_id = 'cainiao';")"
if [[ "$snapshot_date" != "$TODAY" ]]; then
  echo "本地库存快照日期异常：期望 $TODAY，实际 ${snapshot_date:-空}" >&2
  exit 1
fi

echo "[$(date '+%F %T %Z')] 本地导入成功，开始同步云端 ERP"
./scripts/sync-data-to-cloud.sh
echo "[$(date '+%F %T %Z')] 菜鸟采集与云端 ERP 同步完成"
