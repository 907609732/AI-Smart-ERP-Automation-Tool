# 模块代码索引

这个文件是给以后维护用的“地图”。改功能前先查这里，通常不需要重新通读全部代码。

## 前端模块

| 功能 | 主要文件 | 备注 |
| --- | --- | --- |
| 页面结构 | `web/index.html` | 模块容器、表单、表格结构。 |
| 页面样式 | `web/styles.css` | 整体视觉、表格、卡片、Tab、响应式。 |
| 前端交互 | `web/app.js` | API 调用、渲染、导入、编辑、筛选、同行图表。 |
| 交互说明 | `docs/interaction-guide.md` | 页面流程、API 约定、智能体接手规则。 |

## 后端入口

| 功能 | 主要文件 | 备注 |
| --- | --- | --- |
| Express 服务 | `core/erp/server.js` | 所有 API 路由、上传、图片保存、静态页面。 |
| 配置读取 | `core/config.js` | 读取 `.env.local`、`.env`、`config.json`，生成运行目录。 |
| 钉钉发送 | `core/dingtalk.js` | webhook、加签、Markdown 消息。 |

## ERP 业务模块

| 功能 | 主要文件 | 关键点 |
| --- | --- | --- |
| 数据库迁移 | `core/erp/db.js` | SQLite 表结构和兼容性字段补齐。 |
| 表格读取 | `core/erp/sheets.js` | Excel/CSV/TSV 统一读取、字段规范化。 |
| 导入库存/订单/邮费/月出库 | `core/erp/importers.js` | SKU 创建规则、订单扣库存、邮费 ZIP 解析、菜鸟月度出库导入。 |
| 文件档案 | `core/erp/file-archive.js` | 导入文件保存、SHA-256 去重、下载原文件。 |
| 报表和看板 | `core/erp/reports.js` | 库存总览、月出库可售天数、补货预警、订单概览、经营看板、钉钉报表文案。 |
| 商品编码匹配 | `core/erp/order-matching.js` | 待维护订单商品匹配、历史订单补扣库存。 |
| 同行分析 | `core/erp/competitors.js` | SKU 绑定链接、公开页面抓取、快照曲线。 |
| 条码打印/标签编辑器 | `core/erp/barcodes.js` | 扫描汉码模板文件名、合并正式 SKU、保存 SKU 标签模板、生成 Code128/二维码 SVG。 |
| 项目文件扫描 | `core/erp/import-project-folder.js` | 从本地项目资料文件夹导入采购、销售、售后等资料。 |

## 菜鸟库存自动化

| 功能 | 主要文件 | 备注 |
| --- | --- | --- |
| 每日库存下载主流程 | `core/run.js` | 打开菜鸟、复用登录态、下载库存、生成报告、发钉钉。 |
| 手动下载后自动同步 | `core/watch-cainiao-inventory.js` | 监听本机下载目录，新库存文件下载完成后自动导入并发钉钉。 |
| 同步最新库存文件 | `core/sync-cainiao-inventory-file.js` | 把最新库存文件复制到项目、导入菜鸟云仓库存、生成报告并发送钉钉。 |
| 手动登录 | `core/manual-login.js` | 打开 Chrome profile，给验证码/滑块/短信登录用。 |
| 库存报表整理 | `core/process-inventory.js` | 读取库存文件，生成 Markdown/TSV 报告。 |
| 本机 Chrome UI 备用流程 | `core/run-local-chrome-ui.js` | 会操作本机 Chrome UI，仅在其他方式不可用时使用。 |

## 同行平台辅助采集

| 功能 | 主要文件 | 备注 |
| --- | --- | --- |
| 拼多多公开页抓取 | `core/erp/competitors.js` | 先用移动端请求头抓公开页面；若页面要求登录，会记录明确失败原因。 |
| 拼多多手机模式登录/采集 | `core/pdd-mobile-snapshot.js` | 用独立 Playwright 手机模式 profile 打开拼多多，用户登录后复用登录态写入同行快照。 |

## 配置与运行数据

| 项 | 位置 | 说明 |
| --- | --- | --- |
| 业务配置 | `config.json` | 仓库、平台、店铺、列名别名、下载步骤。 |
| 敏感配置 | `.env.local` | 菜鸟账号密码、钉钉 webhook 和 secret，不提交 Git。 |
| launchd 模板 | `config/launchd/com.cainiao.inventory.plist` | macOS 每日定时任务模板。 |
| SQLite 数据库 | `data/erp.sqlite` | 主业务数据库，不提交 Git。 |
| 导入文件档案 | `data/imported-files/` | 原始导入文件，按 hash 去重，不提交 Git。 |
| 商品图片 | `data/product-images/` | SKU 图片，不提交 Git。 |

## 部署与迁移

| 功能 | 主要文件 | 备注 |
| --- | --- | --- |
| Docker 镜像 | `Dockerfile` | 生产容器构建，启动 `npm run erp`。 |
| Compose 编排 | `docker-compose.yml` | ERP 容器、端口、数据挂载、健康检查、资源限制。 |
| 生产环境模板 | `.env.production.example` | 复制为 `.env.production` 后填写钉钉等密钥。 |
| 部署脚本 | `scripts/deploy.sh` | 服务器拉代码、构建容器、启动并检查健康接口。 |
| 备份脚本 | `scripts/backup.sh` | 备份 SQLite、图片、导入档案、上传下载和生产配置。 |
| 服务器部署文档 | `docs/deployment-server.md` | 阿里云 + 宝塔 + Docker Compose 部署步骤。 |
| 迁移文档 | `docs/migration-guide.md` | 换服务器、恢复备份、域名切换。 |

## 常见修改定位

| 需求 | 优先看哪里 |
| --- | --- |
| 新增一个页面模块 | `web/index.html`、`web/app.js`、`web/styles.css` |
| 改导入列名或解析逻辑 | `config.json`、`core/erp/importers.js`、`core/erp/sheets.js` |
| 改库存扣减规则 | `core/erp/importers.js`、`core/erp/order-matching.js` |
| 改经营看板数字 | `core/erp/reports.js` |
| 改钉钉消息内容 | `core/erp/reports.js`、`core/dingtalk.js` |
| 改同行抓取或曲线 | `core/erp/competitors.js`、`web/app.js` |
| 改拼多多登录态采集 | `core/pdd-mobile-snapshot.js`、`core/erp/competitors.js` |
| 改条码标签或打印 | `core/erp/barcodes.js`、`web/app.js`、`web/styles.css` |
| 改每日菜鸟自动化 | `core/run.js`、`config.json`、`automation/cainiao-inventory-daily.md` |
| 让其他智能体接手开发 | `docs/interaction-guide.md`、`docs/module-map.md`、对应模块代码 |
| 改服务器部署方式 | `Dockerfile`、`docker-compose.yml`、`scripts/deploy.sh`、`docs/deployment-server.md` |
