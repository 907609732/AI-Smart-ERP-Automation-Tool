# 菜鸟云仓库存自动化

这个项目每天打开菜鸟云仓，登录后下载库存文件，整理库存数量，并发送到钉钉群。

## 轻量 ERP 本地后台

现在也提供一个本地 ERP 页面，用来导入库存、订单、邮费表格，维护 SKU 成本，查看库存预警和月度销售报表。

启动：

```bash
npm run erp
```

打开：

```text
http://localhost:3000
```

第一版支持：

- 库存导入：菜鸟云仓、上海仓库、诸暨仓库。
- 订单导入：菜鸟云仓、千牛/淘宝、京东、拼多多。
- 邮费导入：按平台和月份汇总邮费。
- SKU 管理：从库存或订单导入生成 SKU，可维护商品名、固定成本价、低库存预警线。
- 报表：库存预警、月度 SKU 销量、销售额、商品成本、邮费、预估毛利。
- 钉钉：可在页面手动发送库存预警和月度销售报表。
- 同行分析：手动添加商品链接，抓取公开页面可见的价格和销量文本；遇到验证码或登录墙会记录失败原因。

数据保存在 `data/erp.sqlite`，上传的临时文件保存在 `uploads/`。敏感配置继续放在 `.env.local`。

## 1. 安装

```bash
npm install
npm run setup
```

## 2. 配置

账号密码放在 `.env.local`，该文件已加入 `.gitignore`。

还需要补充：

```bash
DINGTALK_WEBHOOK=钉钉群机器人 webhook
DINGTALK_SECRET=钉钉机器人加签密钥，没有加签则留空
```

如果库存表列名和默认配置不同，在 `config.json` 的 `inventoryColumns` 中补充列名。

## 3. 配置下载步骤

脚本会先尝试在页面上自动寻找“库存”“导出”“下载”等按钮。如果页面路径不匹配，需要在 `config.json` 的 `downloadSteps` 填入实际步骤：

```json
[
  { "type": "click", "selector": "text=库存管理" },
  { "type": "click", "selector": "text=库存查询" },
  { "type": "download", "selector": "text=导出" }
]
```

支持步骤：`goto`、`click`、`fill`、`press`、`wait`、`download`。

## 4. 手动试跑

```bash
npm run run:headed
```

第一次如果遇到验证码或滑块，在打开的浏览器里手动完成登录。脚本会保存登录态到 `state/cainiao-storage-state.json`，后续会优先复用。

## 5. 每天定时运行

默认模板是每天 09:00 运行：

```bash
mkdir -p logs
cp launchd/com.cainiao.inventory.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cainiao.inventory.plist
```

修改时间时，编辑 `launchd/com.cainiao.inventory.plist` 里的 `Hour` 和 `Minute`。

查看日志：

```bash
tail -f logs/launchd.out.log logs/launchd.err.log
```
