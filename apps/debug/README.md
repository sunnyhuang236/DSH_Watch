# apps/debug（M1 调试面板入口）

M1 的浏览器调试面板由 `dsh-watch` 插件或仓库工具在本机启动：

```bash
# 回放历史会话（无需插件）
cd dsh-mobile-watch && node tools/replay-logs.mjs

# 近实时 tail 正在运行的 DSH 会话（无需插件）
cd dsh-mobile-watch && node tools/watch-logs.mjs
```

然后打开 **http://127.0.0.1:7317/**（面板由 `http://127.0.0.1:7317/` 直接提供，静态文件 `index.html` 只是入口链接）。

面板能力：任务列表（状态徽章/摘要/run_id/更新时间/子代理深度）、任务快照 JSON、最近 500 条归一化事件、每 2 秒自动刷新。数据全部来自本机只读 API，不外网。
