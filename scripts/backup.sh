#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_ROOT="${BACKUP_ROOT:-$ROOT_DIR/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$BACKUP_ROOT/$STAMP"
ARCHIVE="$BACKUP_ROOT/erp-backup-$STAMP.tar.gz"

mkdir -p "$OUT_DIR"

echo "准备备份目录：$OUT_DIR"

if [[ -f data/erp.sqlite ]]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 data/erp.sqlite ".backup '$OUT_DIR/erp.sqlite'"
  else
    cp data/erp.sqlite "$OUT_DIR/erp.sqlite"
  fi
fi

for dir in data/imported-files data/product-images uploads downloads reports logs; do
  if [[ -e "$dir" ]]; then
    mkdir -p "$OUT_DIR/$(dirname "$dir")"
    cp -a "$dir" "$OUT_DIR/$dir"
  fi
done

if [[ -f .env.production ]]; then
  cp .env.production "$OUT_DIR/.env.production"
fi

tar -czf "$ARCHIVE" -C "$OUT_DIR" .
rm -rf "$OUT_DIR"

echo "备份完成：$ARCHIVE"

# 保留最近 14 个本地备份，避免 2核2G 小机器磁盘被打满。
find "$BACKUP_ROOT" -name "erp-backup-*.tar.gz" -type f | sort | head -n -14 | xargs -r rm -f
