# 配置目录

这个目录存放配置模板和运行说明。

| 文件 | 说明 |
| --- | --- |
| `launchd/com.cainiao.inventory.plist` | macOS 每天定时执行菜鸟库存自动化的 launchd 模板。 |

运行时业务配置仍放在项目根目录 `config.json`，敏感配置仍放在项目根目录 `.env.local`。

这样安排的原因：

- `config.json` 是程序直接读取的业务配置，放根目录更直观。
- `.env.local` 是本机敏感信息，已被 `.gitignore` 忽略。
- `config/` 主要放可提交、可复制的模板和说明。
