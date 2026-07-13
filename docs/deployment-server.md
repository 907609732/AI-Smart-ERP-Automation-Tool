# 阿里云服务器部署指南

目标：让 ERP 在阿里云 ECS 上 24 小时运行，本地电脑继续作为开发环境。代码用 Git 同步，数据用 `data/` 等目录持久化，方便以后迁移。

## 推荐架构

```text
用户浏览器
  ↓ HTTPS
宝塔 Nginx / SSL / 反向代理
  ↓ 127.0.0.1:3000
Docker Compose
  └─ ai-smart-erp Node 服务
      ├─ data/erp.sqlite
      ├─ data/imported-files/
      ├─ data/product-images/
      ├─ uploads/
      ├─ downloads/
      ├─ reports/
      └─ logs/
```

当前阿里云服务器是 2 核 2G、3Mbps。这个配置可以先跑 ERP 和少量个人网站，但不要同时跑太多容器。建议加 1-2G swap。

## 一次性准备

服务器执行：

```bash
sudo apt update
sudo apt install -y git curl sqlite3
```

如果宝塔里已经装了 Docker，可以跳过 Docker 安装。命令行检查：

```bash
docker --version
docker compose version
```

如果没有 Docker，可在宝塔 Docker 模块安装，或用官方脚本安装。

如果构建时卡在拉取 `node:24-bookworm-slim`，说明 Docker Hub 网络不稳定。可以二选一处理：

1. 在服务器 Docker 里配置镜像加速器。
2. 临时指定可用的 Node 镜像地址：

```bash
NODE_IMAGE=你的镜像加速地址/node:24-bookworm-slim ./scripts/deploy.sh
```

`Dockerfile` 和 `docker-compose.yml` 已支持 `NODE_IMAGE` 参数，不需要改代码。

## 拉代码

建议放在宝塔常用目录：

```bash
cd /www/wwwroot
git clone git@github.com:907609732/AI-Smart-ERP-Automation-Tool.git
cd AI-Smart-ERP-Automation-Tool
```

如果服务器没有配置 GitHub SSH key，也可以先用 HTTPS 地址 clone。

## 配置环境变量

```bash
cp .env.production.example .env.production
nano .env.production
```

至少填写：

```bash
DINGTALK_WEBHOOK=你的钉钉机器人 webhook
DINGTALK_SECRET=你的钉钉机器人加签
LOW_STOCK_THRESHOLD=10
```

不要把 `.env.production` 提交到 Git。

## 启动服务

```bash
chmod +x scripts/deploy.sh scripts/backup.sh
./scripts/deploy.sh
```

检查：

```bash
curl http://127.0.0.1:3000/api/health
docker compose -p ai-smart-erp ps
docker compose -p ai-smart-erp logs -f erp
```

## 宝塔反向代理

在宝塔里新建站点，例如：

```text
erp.your-domain.com
```

反向代理到：

```text
http://127.0.0.1:3000
```

然后在宝塔里申请 SSL 证书。安全组只需要对公网开放 `80`、`443`、必要时开放 `22`；不要把 `3000` 直接暴露到公网。

## 私有访问认证

生产 ERP 应在 Nginx 的 HTTPS `server` 块中启用 Basic Auth，保护页面和所有 API：

```nginx
auth_basic "ERP Private Access";
auth_basic_user_file /etc/nginx/.htpasswd-erp;
```

密码文件只保存在服务器，不提交 Git。创建或更换 `erp-owner` 密码后，确保 Nginx 工作进程可读取：

```bash
printf 'erp-owner:%s\n' "$(openssl passwd -6 '替换为高强度密码')" | sudo tee /etc/nginx/.htpasswd-erp >/dev/null
sudo chown root:www-data /etc/nginx/.htpasswd-erp
sudo chmod 640 /etc/nginx/.htpasswd-erp
sudo nginx -t && sudo systemctl reload nginx
```

未认证请求应返回 `401`，正确账号密码才能访问 ERP。`scripts/sync-data-to-cloud.sh` 已将公网 `401` 视为认证正常，云端容器健康检查仍在服务器本机完成。

## 更新部署

本地改完代码：

```bash
git add .
git commit -m "更新 ERP 功能"
git push
```

服务器执行：

```bash
cd /www/wwwroot/AI-Smart-ERP-Automation-Tool
./scripts/deploy.sh
```

## 备份

手动备份：

```bash
./scripts/backup.sh
```

宝塔计划任务建议每天凌晨执行：

```bash
cd /www/wwwroot/AI-Smart-ERP-Automation-Tool && BACKUP_ROOT=/www/backup/ai-smart-erp ./scripts/backup.sh
```

备份包包含：

- `data/erp.sqlite`
- `data/imported-files/`
- `data/product-images/`
- `uploads/`
- `downloads/`
- `reports/`
- `logs/`
- `.env.production`

建议再把 `/www/backup/ai-smart-erp` 同步到阿里云 OSS、NAS 或你的本地电脑。

## 2 核 2G 机器注意事项

- Docker Compose 已限制 ERP 容器约 `768m` 内存。
- 不建议在服务器跑菜鸟滑块自动化，容易触发风控，也吃内存。
- 宝塔里不要同时安装 MySQL、Redis、多个大型应用，除非升级到 2 核 4G。
- 图片和导入文件变多后，优先扩容云盘或迁移到 OSS。
