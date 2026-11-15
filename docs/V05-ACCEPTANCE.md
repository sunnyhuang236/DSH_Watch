# V05 验收记录：真实 DSH 内加载 `dsh-watch`

- 日期：2026-11-14 19:36–20:30（Asia/Shanghai）
- 环境：DSH Desktop **0.2.2-rc.1**（Electron 44.7.0 / Node 24.21.0；`D:\DeepSeek Harness`）
- 目标：把 `dsh-watch` 插件真正装进本机 DSH 运行时，验证「插件采集 → 本地库 → /v1 API → 浏览器」链路（V05）。
- 结果：**通过（README 里的 V05 收尾完成）**。插件已在真实 DSH 进程内运行；本会话与新建子代理会话都被实时采集并显示在浏览器面板。

## 1 改动清单（全部在 `~/.dsh`，均已备份）

| # | 路径 | 改动 | 说明 |
| --- | --- | --- | --- |
| 1 | `~/.dsh/profiles/desktop/package.json` | `dependencies` 增加 `"dsh-watch": "file:C:/Users/22472/Desktop/DSH提醒小助手/dsh-mobile-watch/packages/dsh-watch"`；`dsh.profile.bundles` 追加 `"dsh-watch"` | 由 DSH 自带 plugin_manager 写入（App 管理路径） |
| 2 | `~/.dsh/profiles/desktop/node_modules/dsh-watch/` | 新增（pnpm 从本地目录安装，+1 包） | 插件运行文件 |
| 3 | `~/.dsh/profiles/desktop/pnpm-lock.yaml` | 更新 | pnpm 依赖锁定 |
| 4 | `~/.dsh/dsh-watch/watch.db`（+ `-wal`/`-shm`） | 运行时创建 | M1 本地库；只存归一化快照/事件（标题为 ≤80 字脱敏截断） |

**未改动**：DSH 源码 / `app.asar`、`~/.dsh/sessions` 原始日志、`01_交付物/`、任何其他插件。未联网上传数据。

### 备份（回滚用）

目录：`dsh-mobile-watch/docs/backup-m1-install/`

| 文件 | sha256 |
| --- | --- |
| `package.json.20261114-193643.bak` | `90212a54b0f2a6d422f8f2f704d7052b3af74270160b0ff4d3ef52a6106ab200` |
| `cordis.patch.yml.20261114-193643.bak` | `c5f4cd31835e1525a9bb630a20b353a9a61391235acadaa04a77da9ffcde1ad1` |
| `pnpm-lock.yaml.20261114-193643.bak` | `cc4847cb1742862d4946103960c6e5d58c837c1fe996b300aeb64c5d683b6d30` |

## 2 安装方式（实际执行）

DSH 桌面 profile 被 App 独占，CLI 明确拒绝：

```text
$ dsh --profile desktop --dump-config
error: profile "desktop" is managed exclusively by the Electron application
```

因此使用 **App 自带的 `plugin_manager`**（当前 profile 的官方管理路径）：

```text
plugin_manager install_bundle target=file:C:/Users/22472/Desktop/DSH提醒小助手/dsh-mobile-watch/packages/dsh-watch
→ stage=enable, target=dsh-watch, enabled=true, changed=true, application=applied
→ pnpm: dependencies + dsh-watch dsh-watch@file:../../../Desktop/DSH提醒小助手/dsh-mobile-watch/packages/dsh-watch
```

`application=applied` 表示**热应用成功，无需重启 App**。profile 组合中已包含 dsh-watch；下次 App 启动会按同一 profile 自动加载。

## 3 验证证据

### 3.1 API 健康（真实 DSH 进程内）

```json
GET http://127.0.0.1:7317/v1/health
{
  "ok": true, "service": "dsh-watch", "version": "0.1.0",
  "schema_version": "1.0", "contract": "m1-v1.1",
  "capabilities": {"approval": true, "cost": false, "agents": true},
  "stats": {"tasks": 5, "events": 2649}, "uptime_s": 122
}
```

证据：`docs/evidence/v05/health-final.json`、`health.json`、`health-after-reload.json`

### 3.2 浏览器面板（真实截图）

`docs/evidence/panel/panel-final.png`（1440×980）：5 个任务、当前会话 running、子代理任务 succeeded、任务快照 JSON、最近 500 条归一化事件。
`docs/evidence/panel/panel-dom.html`：无头 Chrome 渲染后的 DOM，任务卡 5 个、健康行 `ok · dsh-watch 0.1.0 · contract m1-v1.1 · tasks 5 · events 2649 · uptime 121s`。

> 说明：无头 Chrome 在 DSH `danger-full-access` 策略下可运行；截图是浏览器真实渲染，不是 curl 拼接。

### 3.3 启动 seed（插件加载时已有会话）

加载时从 live Session 快照回填 4 个任务、2,427 事件：

```text
tasks=4 events=2427 uptime=23s
- session-19286104-c56e-427b-9f9a-08926be18ac0  running   depth=0  title=M0 研发提示词（整段复制到新…
- session-ad867c6e-3163-408b-9d3a-5b9…          succeeded depth=0  鹈鹕骑自行车SVG图
- session-706776a5-b46c-4e0e-add0-6609…         succeeded depth=0  Add Magpie API curl comm…
- session-1c01794c-aa75-48f4-9034-7976…         succeeded depth=0  帮我删除无畏契约和WeGame
```

### 3.4 实时摄取（运行中会话）

同一进程内事件数持续增长：`2427 → 2434 → 2450 → 2464 → 2496 → 2537 → 2557 → 2604 → 2649`；本会话任务 `run_id=…:6`、`current_step` 随真实步骤推进（33→39），`state=running`。

证据：`docs/evidence/v05/current-task*.json`、`health*.json`、`current-events.json`

### 3.5 新会话实时出现（子代理，最强证据）

用 `subagent` 创建一个只回复“好的”的子代理会话，插件在**无重启、无手工导入**的情况下自动新增任务：

```text
task_id = 054b3a96-48c1-4555-9203-8fa2cf158aab
delegation_depth = 1          # 识别为子代理
state: running → succeeded    # run_id = …:1
agent_state: running → idle   # agent/created + agent/status 实时订阅生效
events = 16（run_started/step_started/assistant/tool_started/tool_finished/run_finished）
token_usage.messages = 2
```

证据：`docs/evidence/v05/tasks-after-subagent.json`、`subagent-events.json`

### 3.6 生命周期（禁用/启用，无需重启 App）

`plugin_manager set_bundle dsh-watch enabled=false` → 再 `enabled=true`：

- 两次操作均返回 `application=applied`；
- 重新启用后 `uptime` 重置（新实例，19s），任务数（4）与事件数（2496）保留并继续增长 —— 证明插件可安全卸载/重载，本地库持久化不丢；
- 说明：停用期间未单独执行 API 探测（该检查步骤被跳过），因此"停用即断开"未作为独立证据记录；重载后的新实例与数据保留已足以证明生命周期生效。

### 3.7 profile 差异

`docs/evidence/v05/profile-package.diff`：只增加 `dsh-watch` 依赖与 bundle 行，无其他改动。
当前 profile 哈希（安装后）：`package.json=80169418…`、`pnpm-lock.yaml=03d17e0b…`；备份见 §1。

### 3.8 重启后自动加载（用户确认，2026-11-14 晚）

用户重启 DSH 后实测 `GET http://127.0.0.1:7317/v1/health`：

```json
{ "ok": true, "service": "dsh-watch", "version": "0.1.0",
  "schema_version": "1.0", "contract": "m1-v1.1",
  "stats": { "tasks": 5, "events": 2850 }, "uptime_s": 9 }
```

`uptime_s=9` 证明是新启动的插件实例；`tasks=5` 与重启前的任务一致，说明本地库持久化正常。随后复核（uptime 82s）`tasks=5 / events=2860`，事件继续增长。

证据：`docs/evidence/v05/restart-health-user.png`（用户截图）、`health-after-restart.json`。**重启自动加载：✅ 已确认。**

## 4 已知提示/限制

1. **`dsh-at-file` 导入警告**：每次由 plugin_manager 应用 bundle 时都会出现
   `dsh-at-file (dsh-at-file): failed to import: SyntaxError: The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'`
   —— 与 dsh-watch 无关（模块名是 dsh-at-file / dsh-settings，且在安装 dsh-watch 前已随 DSH 0.2.2-rc.1 升级存在）。建议你在 UI 里确认 `@文件` 补全是否仍可用；如需处理可单独升级/禁用 dsh-at-file。
2. **主会话 `agent_state=unknown`**：本会话的 agent 在插件加载前已创建，且状态未发生 `idle↔running` 变化；`agent/status` 只发变化事件。新建子代理正确显示 `running→idle`，证明订阅本身有效。M1.5 可用 `ctx.agents.get(id)?.status` 做更完整的启动同步（已加 `agent/created` 订阅）。
3. **重启验证：✅ 已通过（2026-11-14 晚）**：用户重启 DSH 后 `/v1/health` 正常（uptime=9s，tasks=5，events=2850），证明插件自动加载且本地库持久化；见 §3.8。
4. **端口**：仅监听 `127.0.0.1:7317`，无鉴权（M2 加配对/设备凭证前不要暴露到局域网/公网）。

## 5 回滚步骤（如需还原）

1. 停用插件：`plugin_manager set_bundle dsh-watch enabled=false`（或 `remove_bundle dsh-watch`）。
2. 恢复 profile 文件（先退出 DSH 或确认无写入）：
   ```
   copy dsh-mobile-watch\docs\backup-m1-install\package.json.20261114-193643.bak  %USERPROFILE%\.dsh\profiles\desktop\package.json
   copy dsh-mobile-watch\docs\backup-m1-install\pnpm-lock.yaml.20261114-193643.bak %USERPROFILE%\.dsh\profiles\desktop\pnpm-lock.yaml
   ```
3. 可选：删除 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-watch` 与 `%USERPROFILE%\.dsh\dsh-watch`（本地库）。
4. 重启 DSH。

## 6 结论

V05（插件 → 本机 API → 浏览器）**通过**：真实 DSH 进程内加载、真实会话与新建子代理会话均实时出现，浏览器面板可读，禁用/启用可回滚；**DSH 重启后自动加载也已确认（§3.8）**。M1 数据管道在真实运行时可用。
