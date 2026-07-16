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
SUCCESS_MARKER="state/launchd-last-success-date"

if [[ "${ENFORCE_SCHEDULE_HOUR:-0}" == "1" ]]; then
  business_hour="$(TZ="$BUSINESS_TIME_ZONE" date +%H)"
  if (( 10#$business_hour < 22 || 10#$business_hour > 23 )); then
    exit 0
  fi
  if [[ -f "$SUCCESS_MARKER" && "$(<"$SUCCESS_MARKER")" == "$TODAY" ]]; then
    echo "[$(date '+%F %T %Z')] 中国业务日期 ${TODAY} 已采集并同步，跳过重复执行。"
    exit 0
  fi
fi

echo "[$(date '+%F %T %Z')] 开始菜鸟库存采集，业务日期：$TODAY"
DINGTALK_SKIP_SEND=1 npm run sync:inventory:full

snapshot_date="$(sqlite3 data/erp.sqlite "SELECT COALESCE(MAX(snapshot_date), '') FROM inventory_snapshots WHERE warehouse_id = 'cainiao';")"
if [[ "$snapshot_date" != "$TODAY" ]]; then
  echo "本地库存快照日期异常：期望 $TODAY，实际 ${snapshot_date:-空}" >&2
  exit 1
fi

echo "[$(date '+%F %T %Z')] 本地导入成功，开始同步云端 ERP"
./scripts/sync-data-to-cloud.sh
if [[ "${SKIP_CLOUD_REPORT_SEND:-0}" == "1" ]]; then
  echo "[$(date '+%F %T %Z')] 云端数据已更新，按测试配置跳过钉钉库存报告发送"
else
  echo "[$(date '+%F %T %Z')] 云端数据已更新，发送带确认催办的库存报告"
  ssh aliyun-erp \
    "curl -fsS -X POST -H 'Content-Type: application/json' -d '{\"type\":\"inventory\"}' http://127.0.0.1:3000/api/dingtalk/send-report >/dev/null"
fi
echo "[$(date '+%F %T %Z')] 菜鸟采集与云端 ERP 同步完成"

# The marker is written only after the cloud report has also succeeded. A failed run can retry
# during the China-time catch-up window instead of being recorded as complete.
if [[ "${ENFORCE_SCHEDULE_HOUR:-0}" == "1" && "${SKIP_CLOUD_REPORT_SEND:-0}" != "1" ]]; then
  mkdir -p "$(dirname "$SUCCESS_MARKER")"
  printf '%s\n' "$TODAY" > "$SUCCESS_MARKER"
fi
