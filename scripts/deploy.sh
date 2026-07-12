#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env.production" ]]; then
  echo "缺少 .env.production，请先执行：cp .env.production.example .env.production 并填写配置。"
  exit 1
fi

mkdir -p data uploads downloads reports state logs

# 国内服务器偶尔拉不动 Docker Hub，可临时这样执行：
# NODE_IMAGE=你的镜像加速地址/node:24-bookworm-slim ./scripts/deploy.sh
export NODE_IMAGE="${NODE_IMAGE:-node:24-bookworm-slim}"

echo "拉取最新代码..."
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git pull --ff-only || echo "git pull 未执行成功，继续使用当前代码构建。"
fi

echo "构建并启动 ERP 容器..."
docker compose -p ai-smart-erp up -d --build

echo "等待健康检查..."
for i in {1..30}; do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "部署完成：http://127.0.0.1:3000/api/health 正常。"
    exit 0
  fi
  sleep 2
done

echo "服务未在预期时间内健康，请查看日志：docker compose -p ai-smart-erp logs -f erp"
exit 1
