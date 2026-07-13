# ERP 迁移指南

这份文档用于一年后换服务器、从阿里云迁到其他云，或从本地 Docker 迁到云端 Docker。

## 迁移原则

代码和数据分开：

| 类型 | 位置 | 迁移方式 |
| --- | --- | --- |
| 代码 | GitHub 仓库 | 新服务器 `git clone` |
| 敏感配置 | `.env.production` | 手动复制或从加密备份恢复 |
| 数据库 | `data/erp.sqlite` | 从备份包恢复 |
| 导入档案 | `data/imported-files/` | 从备份包恢复 |
| 商品图片 | `data/product-images/` | 从备份包恢复 |
| 临时上传/下载 | `uploads/`、`downloads/` | 按需要恢复 |
| 日志/报表 | `logs/`、`reports/` | 按需要恢复 |

## 旧服务器打包

```bash
cd /www/wwwroot/AI-Smart-ERP-Automation-Tool
docker compose -p ai-smart-erp down
./scripts/backup.sh
```

把最新的备份包传到新服务器：

```bash
scp backups/erp-backup-YYYYMMDD-HHMMSS.tar.gz root@新服务器IP:/root/
```

## 新服务器恢复

```bash
cd /www/wwwroot
git clone git@github.com:907609732/AI-Smart-ERP-Automation-Tool.git
cd AI-Smart-ERP-Automation-Tool
tar -xzf /root/erp-backup-YYYYMMDD-HHMMSS.tar.gz
chmod +x scripts/deploy.sh scripts/backup.sh
./scripts/deploy.sh
```

检查：

```bash
curl http://127.0.0.1:3000/api/health
docker compose -p ai-smart-erp ps
```

## 域名切换

如果使用宝塔：

1. 新服务器宝塔新建站点。
2. 配置反向代理到 `http://127.0.0.1:3000`。
3. 申请 SSL。
4. 域名 DNS A 记录切到新服务器 IP。
5. 在 Nginx HTTPS `server` 块恢复 `auth_basic` 和 `/etc/nginx/.htpasswd-erp`，确认未认证访问返回 `401`。
6. 确认使用认证账号访问正常后，再停止旧服务器。

## 本地和云端双环境

本地也可以 Docker 跑同一套服务：

```bash
cp .env.production.example .env.production
docker compose -p ai-smart-erp up -d --build
```

如果本地浏览器要直接访问容器，可以把 `docker-compose.yml` 的端口从：

```yaml
"127.0.0.1:3000:3000"
```

改成：

```yaml
"3000:3000"
```

云端生产环境建议继续只监听 `127.0.0.1`，由宝塔/Nginx 代理。
