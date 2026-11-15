# dsh-watch（M1）

DSH host 侧插件：订阅会话事件 → 归一化 → 状态机 → SQLite → `127.0.0.1:7317` 只读 `/v1` API + 浏览器调试面板。
契约：**m1-v1.1（已冻结）**，见 `contract/README.md`；样本与回归见 `fixtures/`、`docs/M1-REPORT.md`。

## 包结构

```
lib/index.js           Cordis 插件入口（apply/inject/name；订阅 session/event、agent/status、agent/created、agent/error、goal/changed）
lib/runtime.mjs        运行时（DB + 摄取 + API 生命周期；启动时 seed 历史事件与 live agent 状态）
lib/api.mjs            /v1 只读 API + / 调试面板
lib/panel.html         调试面板（浏览器直接打开 /）
lib/core/contract.mjs  契约常量（task_id/run_id/event_id、状态、事件类型）
lib/core/normalize.mjs DSH 事件 → 归一化 TaskEvent
lib/core/state.mjs     状态机（终态按 run 不可逆、等待窗口、token 累计）
lib/core/store.mjs     node:sqlite 本地库（tasks/events，event_id 幂等）
lib/core/pipeline.mjs  摄取事务（插入事件 + 更新快照原子化）
lib/core/redact.mjs    标题/摘要脱敏
```

## 在 DSH 中启用（需要用户确认，M1 未自动执行）

1. 把 `packages/dsh-watch/` 作为本地插件安装到 desktop profile（方式取决于 DSH 桌面 App 插件页是否支持本地目录）；
2. profile 的 `cordis.patch.yml` 增加（或由插件包自动带入）：
   ```yaml
   - insert:
       - id: dsh-watch
         name: dsh-watch
         config:
           port: 7317
           host: 127.0.0.1
   ```
3. 重启 DSH 后打开 `http://127.0.0.1:7317/` 查看面板；`GET http://127.0.0.1:7317/v1/health` 应为 200。

## 不安装插件时的验收入口

使用仓库根目录的两个只读工具（同一套 normalize/state/store/API）：

```bash
node tools/replay-logs.mjs   # 回放 ~/.dsh/sessions 最近会话
node tools/watch-logs.mjs    # 近实时 tail 会话日志（500ms）
```

## 边界

- 只监听 `127.0.0.1`，无鉴权（M2 加配对/设备凭证）。
- 只存归一化数据：不存完整用户正文、工具参数、审批原因、系统提示、绝对路径；任务标题为真人消息的 ≤80 字脱敏截断，事件只留 `text_len`。
- 不修改 DSH 配置与原始日志；插件卸载时关闭 HTTP 与 SQLite。
- 若宿主未启用 `node:sqlite`，会自动降级为内存库（面板可用，DSH 重启后丢历史）。
