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
npm run run:headed       # 打开浏览器执行菜鸟库存下载、整理
npm run sync:inventory:cloud # 采集菜鸟库存并同步云端 ERP；云端企业应用机器人发送报告
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

# 库存报告使用钉钉企业内部应用机器人，不使用旧群 Webhook。
DINGTALK_CLIENT_ID=企业应用 Client ID
DINGTALK_CLIENT_SECRET=企业应用 Client Secret
DINGTALK_REMINDER_ENABLED=true
DINGTALK_REMINDER_TARGET_USER_ID=陈奇慧的钉钉 userid
DINGTALK_REMINDER_BOT_NAME=AI自动化机器人
DINGTALK_REMINDER_ROBOT_CODE=企业应用 RobotCode
```

本机定时任务只负责采集和同步，使用 `DINGTALK_SKIP_SEND=1` 避免本机旧 Webhook 重复发报；云端 ERP 收到同步数据后，由已加入日报群、启用 Stream 的企业应用机器人发送库存报告。所有预警行会展示在报告中，只有“不够卖 1 周”的商品才会真实 `@` 指定人员；收到、取消等群内指令也由同一企业应用机器人处理。

`DINGTALK_WEBHOOK` 和 `DINGTALK_SECRET` 仅保留给历史兼容调用，不再是库存日报的必填配置。

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
- 钉钉同步：库存日报由云端钉钉企业应用机器人发送并处理确认催办；旧 Webhook 仅兼容历史调用。
- 库存确认催办：库存日报自动 `@` 指定员工，未回复时每小时提醒，收到本人确认后停止。

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
PROJECT_ROOT="$(cd "$PWD" && /bin/pwd -P)"
sed -i '' "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" ~/Library/LaunchAgents/com.cainiao.inventory.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cainiao.inventory.plist
```

定时任务以中国时间每天 `22:00` 为准。当前 Mac 使用美国东部时区，模板会在本机 `09:00` 和 `10:00` 检查，并只在中国时间 `22:00-23:59` 执行，因此可跨夏令时运行。另有每 30 分钟的轻量检查：若电脑在 22:00 短暂睡眠、当天在 23:59 前恢复，任务会补跑；成功后写入当天成功标记，避免重复采集和重复发报。

电脑完全关机或跨过中国时间午夜才恢复时，`launchd` 无法替代开机/唤醒。需要在 macOS 电源设置中开启“唤醒以供网络访问”，并让 Mac 在该时段保持开机；日志会保留失败记录，下一次可按上面的验证命令手动补跑。

macOS 可能禁止后台 `launchd` 访问“文稿/Documents”。本机正式运行目录已放到 `~/Developer/菜鸟云仓自动化操作`，原来的“文稿”路径保留了同名软链接；安装任务时上面的 `pwd -P` 会自动写入真实路径，避免每日任务因目录权限被跳过。

查看日志：

```bash
tail -f logs/launchd.out.log logs/launchd.err.log
```

验证时可由 `launchd` 本身执行一次、同时避免向群里额外发送测试报告：

```bash
launchctl setenv SKIP_CLOUD_REPORT_SEND 1
launchctl kickstart -kp gui/$(id -u)/com.cainiao.inventory
launchctl unsetenv SKIP_CLOUD_REPORT_SEND
```

## 本机中文备注

目录保持英文，方便 GitHub、Node 脚本和跨平台协作。你本机 Finder 可以显示中文备注：

```bash
npm run set-folder-comments
```

这些备注写入 macOS 本机 Finder metadata，`.DS_Store` 已忽略，不会提交到 GitHub。其他人 clone 仓库后只会看到正常英文目录结构。
