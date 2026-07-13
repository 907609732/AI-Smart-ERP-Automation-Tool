# AI Smart ERP Automation Tool

这是一个本地轻量 ERP + 菜鸟云仓自动化项目，用来管理库存、订单、邮费、经营看板、同行价格分析，并把关键结果发送到钉钉。

## 快速启动

```bash
npm install
npm run erp
```

打开：

```text
http://localhost:3000
```

常用命令：

```bash
npm run erp              # 启动本地 ERP
npm run run:headed       # 打开浏览器执行菜鸟库存下载、整理、钉钉发送
npm run sync:inventory:cloud # 采集菜鸟库存、发送钉钉并同步云端 ERP
npm run manual-login     # 单独打开登录窗口，处理验证码/滑块/短信
npm run test:process     # 只处理最近下载的库存文件
npm run pdd:login        # 打开拼多多手机模式登录窗口，保存独立登录态
npm run pdd:snapshot     # 用手机模式采集启用的拼多多同行链接
npm run set-folder-comments # 给本机 Finder 文件夹写入中文备注
```

Docker 部署：

```bash
cp .env.production.example .env.production
./scripts/deploy.sh
```

## 目录结构

| 目录 | 用途 |
| --- | --- |
| `core/` | 系统核心代码：后端 API、数据库、导入解析、报表、钉钉、自动化脚本 |
| `web/` | 本地 ERP 前端页面：HTML、JS、CSS |
| `data/` | 本地数据中心：SQLite 数据库、导入文件档案、商品图片，默认不提交 Git |
| `uploads/` | 上传临时文件，默认不提交 Git |
| `downloads/` | 自动化下载文件，默认不提交 Git |
| `reports/` | 生成报表、调试输出，默认不提交 Git |
| `state/` | 浏览器登录态、Chrome profile、运行状态，默认不提交 Git |
| `logs/` | 服务、定时任务、自动化日志，默认不提交 Git |
| `docs/` | 项目文档、架构说明、模块索引 |
| `automation/` | 每日自动化流程说明和本机辅助脚本 |
| `config/` | 配置模板、launchd 模板、环境变量说明 |

详细维护文档：

- [系统架构](docs/architecture.md)
- [ERP 交互与智能体接手指南](docs/interaction-guide.md)
- [模块代码索引](docs/module-map.md)
- [阿里云服务器部署指南](docs/deployment-server.md)
- [ERP 迁移指南](docs/migration-guide.md)
- [菜鸟库存每日自动化流程](docs/automation-cainiao-inventory.md)

## 配置

敏感配置放在根目录 `.env.local`，不要提交到 Git：

```bash
CAINIAO_USERNAME=菜鸟账号
CAINIAO_PASSWORD=菜鸟密码
DINGTALK_WEBHOOK=钉钉群机器人 webhook
DINGTALK_SECRET=钉钉机器人加签密钥，没有加签则留空
```

业务配置放在根目录 `config.json`，包括仓库、平台、店铺、库存列名别名、下载步骤和低库存阈值。

生产服务器使用 `.env.production`，从 `.env.production.example` 复制后填写。`.env.production` 不提交 Git。

## 本地 ERP 功能

- 库存总览：正式库存商品、三仓库存、成本、预警线、图片、操作日志。
- 待维护订单商品：订单导入但未匹配正式 SKU 的商品单独折叠管理。
- 订单管理：按月份和店铺查看订单，只展示订单相关信息。
- 店铺商品管理：维护平台商品编码、规格和正式 SKU 的映射。
- 导入中心与文件档案：导入库存、订单、邮费，并保存不重复的原始文件。
- 经营看板：销售额、邮费、采购售后、毛利估算自动可视化。
- 条码打印：参考汉码模板命名，按产品大类、商品、条形码生成 Code128 标签并打印。
- 同行分析：按正式 SKU 绑定淘宝/拼多多/京东链接，长期保存价格和销量快照。
- 钉钉同步：手动或定时发送库存预警、月度报表。

拼多多如果公开页返回登录墙，先执行 `npm run pdd:login`，在弹出的手机模式窗口里登录；之后执行 `npm run pdd:snapshot`，系统会复用 `state/pdd-mobile-profile` 的登录态采集页面可见价格和销量。

## 每天定时运行

launchd 模板位置：

```bash
config/launchd/com.cainiao.inventory.plist
```

安装示例：

```bash
mkdir -p logs
cp config/launchd/com.cainiao.inventory.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cainiao.inventory.plist
```

定时任务以中国时间每天 `22:00` 为准。当前 Mac 使用美国东部时区，模板会在本机 `09:00` 和 `10:00` 检查，并只在中国时间恰好为 `22:00` 时执行，因此可跨夏令时运行。

查看日志：

```bash
tail -f logs/launchd.out.log logs/launchd.err.log
```

## 本机中文备注

目录保持英文，方便 GitHub、Node 脚本和跨平台协作。你本机 Finder 可以显示中文备注：

```bash
npm run set-folder-comments
```

这些备注写入 macOS 本机 Finder metadata，`.DS_Store` 已忽略，不会提交到 GitHub。其他人 clone 仓库后只会看到正常英文目录结构。
