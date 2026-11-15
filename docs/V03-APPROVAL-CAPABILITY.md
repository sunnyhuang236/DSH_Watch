# V03 审批/提问能力核查

日期：2026-11-15｜DSH 版本：0.2.2-rc.1｜结论：**approval live capture 已通过，手机审批可进入实现；user-questions live capture 待补**。

## 1 源码证据（只读，不改 DSH）

| 事实 | 来源 |
| --- | --- |
| `approval/request` 是 Cordis **waterfall** 事件，监听器签名 `(request, next)` | `@deepseek-ai/dsh-user-approval/lib/index.js`；`dsh-api-remotes/lib/types/remote-events.js` |
| 请求字段：`agent`、`toolName`、可选 `callId`、`reason`、`displayReason`、`signal` | `dsh-client-ui-approval/lib/client.js` 的 `answerApproval` |
| 结果词汇：`allowed-once` / `rejected` / `cancelled` / `unavailable`；只有 `allowed-once` 是授权 | `dsh-user-approval/lib/types/index.js` |
| 中止信号 → `cancelled`；应答者缺失/抛错/非词汇返回 → `unavailable`（fail closed） | `dsh-user-approval/lib/index.js` 的 `decide()` |
| `ApprovalService.request()` 生成 UUID，先 append `approval/asked`，再 append `approval/decided`；要求 turn 打开 | `dsh-user-approval/lib/index.js` |
| 已有桌面 UI 通过 `ctx.remote.$on('approval/request', (request, next) => answerApproval(...))` 消费 | `dsh-client-ui-approval/lib/client.js` |
| `user-questions` 也是 waterfall；`ask()` / `askTimed()`，问题由 `ask_user_question` 工具调用投影，`answer` RPC 回写 | `dsh-user-questions/README.zh.md`、`lib/index.js` |

## 2 对手机审批的直接结论

1. **不需要改 DSH 源码**：插件可以注册 `ctx.on('approval/request', (request, next) => ...)`，用 `next()` 保留桌面 UI 的原有处理。
2. **必须“一次决定”**：手机只能返回 `allowed-once` 或 `rejected`；不能做“始终允许”。
3. **必须与桌面抢答**：桌面 UI 和手机同时可能作答；手机方案要保证第一个有效决定生效，后到者返回冲突/已过期。
4. **重启不补执行**：`approval/asked` 是会话审计事件，但待处理请求本身只在内存；插件/网关重启后旧 pending 必须标记过期，不能自动执行。
5. **`user-questions` 更复杂**：问答有 `open` / `continued` 状态、tool call 结果和 `answer` RPC；建议审批先做，问答后做。

## 3 live capture（历史真实会话）

20 个历史 DSH 会话日志（共扫描 54 个）中实际抓到：

- **69 组** `approval/asked` + `approval/decided`，**69 组全部配对**（0 丢失）；
- outcome：**68 次 `allowed-once`，1 次 `rejected`**；
- 工具分布：`ops_bash` 39、`pwsh` 18、`edit` 5、`plugin_manager` 4、`job_output` 2、`run_code` 1；
- 持久字段：`id`、`toolName`、`callId`、`reason`（`displayReason` 只在 live request/UI，不落盘）；
- 决定耗时：最短 1.4s，中位数 26.5s，最长 43.8 分钟（含用户离开）；
- `approval/policy`：`ask` 24 次、`never` 33 次（均为历史真实记录）。

证据：`docs/evidence/v03/approval-live.json`（已脱敏 reason）。

结论：**approval/request 的 live capture 通过**；桌面允许/拒绝的真实 outcome 可被持久审计事件验证。

**Status: 源码核查 ✅；approval live capture ✅；user-questions live capture ⏳（该事件是 live-only，需另触发一次 ask_user_question）。**

## 4 下一步最小实现（M4-A）

1. 在 `dsh-watch` 插件增加**只读 probe**：监听 `approval/request`，记录脱敏字段后调用 `next()`，不改变桌面行为；
2. 用一次真实审批触发，写 `docs/evidence/v03/approval-live.json`；
3. 再加手机端 action 通道（先不做 UI）：`action_request` / `decision` / `conflict` / `expired`；
4. 最后接 PWA 卡片与 AC17 双端抢答测试。

> approval 的 live capture 已通过，可以开始写手机允许/拒绝 UI；user-questions 仍只做只读展示，等 live capture 后再开放回答。
