# M4-A 手机审批（后端 + PWA 卡片）

日期：2026-11-15｜状态：**手机审批真机通过（action=decided / decision=mobile / allowed-once）**；M4-B 问答桥代码完成，70/70 测试通过；桌面抢答冲突/拒绝真机测试待补。

## 1 范围

只做 **approval/request** 的一次性手机决定；不做 user-questions 回答、不做 APNs/TestFlight、不做轨迹/费用。

## 2 已实现

### 插件侧（dsh-watch）

- 新增 `lib/core/approvals.mjs`：内存 pending action 桥。
- 监听 `approval/request`，使用 `{ global: true, prepend: true }` 先进入 waterfall，但始终调用 `next()` 保留桌面审批 UI。
- 桌面与手机竞速：
  - 手机先返回 `allowed-once`/`rejected` → 桌面后到不覆盖；
  - 桌面先返回 → 手机 decision 返回 `conflict`；
  - `request.signal` abort → `cancelled`；
  - 插件重启 → pending 丢失，旧 action 查询返回 `expired`，不补执行。
- action 只在内存保存 5 分钟；不写业务正文到日志/磁盘。

### 插件 HTTP API（127.0.0.1:7317）

```
GET  /v1/actions?task_id=<session-id>
GET  /v1/actions/<action-id>
POST /v1/actions/<action-id>/decision
body: {"decision":"allowed-once"} | {"decision":"rejected"}
```

响应：`200 accepted` / `409 conflict` / `410 expired` / `400 bad_request`。

### 网关反代（8787，设备 Bearer token）

- GET `/v1/actions*` 反代到插件；
- POST `/v1/actions/<id>/decision` 反代到插件；
- 仅持有设备 token 的手机可调用。

### PWA

- 任务详情加载 `/v1/actions?task_id=...`；
- 待审批显示“需要你的决定”卡片，含工具/reason、允许一次/拒绝；
- 提交后显示“已提交，等待电脑确认”，刷新后显示“审批已处理”；
- 不改 M1 `m1-v1.1` 任务契约；M4 action 是新增接口。

## 3 测试

`npm test`：**70/70 通过**（含 ApprovalBridge、QuestionBridge、API decision 测试）。

## 4 真机验证（2026-11-15 18:35）

- PWA 任务详情显示真实审批卡（截图 `docs/evidence/m4/approval-card.jpg`）；
- 手机点击 **允许一次**；
- action `act_dba81f1f-7071-40fc-9c0b-bed1baa757a3`：
  - `status=decided`
  - `decision=mobile`
  - `outcome=allowed-once`
- 对应任务“校园自习室预约系统开发”从 `waiting_approval` 恢复为 `running`，步骤 107；
- 证据：`docs/evidence/m4/approval-mobile.json`。

结论：**手机审批 → DSH 回执链路通过**。

## 5 待验证

1. 桌面先点允许，手机后提交 → `conflict`；
2. 插件重启后旧 pending → `expired`；
3. 拒绝路径（本次只测了允许）；
4. user-questions 的 phone answer（V03 的 user-questions live capture 尚未完成）。

## 6 已知 UI 限制

手机审批成功后，DSH 桌面端的旧审批卡可能仍显示“等待审批”，因为 DSH client 没有广播 `approval/decided` 给其他已打开的审批 UI；任务实际已恢复运行。刷新/切换会话后桌面卡会消失。这个问题不影响审批结果，但需要在正式 M4 UI 说明或后续用 DSH 客户端事件补齐。当前 PWA 的顶部刷新只刷新任务数据，不能刷新 DSH 桌面审批卡。

## 5 安全边界

- action 只存内存，不写入 `approval-live` 或任务快照；
- 手机接口必须设备 token；
- 不提供“始终允许”；不提供跨设备重放；
- 只处理单次 `allowed-once`/`rejected`，不伪造工具结果。
