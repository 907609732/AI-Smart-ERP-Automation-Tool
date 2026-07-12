# 本机 Finder 中文备注

项目目录保持英文名，方便 GitHub、Node、命令行和跨平台协作。

如果想在你自己的 Mac Finder 里看到中文说明，执行：

```bash
npm run set-folder-comments
```

备注写入 macOS Finder metadata，通常保存在本机 `.DS_Store` 中。`.DS_Store` 已经在 `.gitignore` 里，因此不会提交到 GitHub，其他人 clone 仓库后只会看到英文目录。
