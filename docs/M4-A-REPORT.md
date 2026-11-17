# M4-A 手机审批（后端 + PWA 卡片）

日期：2026-11-15｜状态：**手机审批允许/拒绝/冲突 + 插件重启 expired 均已真机/隔离环境通过**；M4-B 问答桥真机通过；73/73 测试通过。

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

`npm test`：**73/73 通过**（含 ApprovalBridge、QuestionBridge、API decision 测试）。

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

## 5 边界验证

1. **手机拒绝**：✅ 2026-11-15 在 `m4-edge` 隔离 profile 通过（测试 Web UI 产生 pending，测试网关同一 PWA 接口提交 rejected）：
   - action `act_30113e39-9455-4fbb-8e4c-78b557bbd316`
   - `status=decided / decision=mobile / outcome=rejected`
   - `probe-reject.txt` 不存在
   - 证据：`docs/evidence/m4-edge/reject-mobile.json`
2. **桌面先允许 → 手机 conflict**：✅ 2026-11-15 在 `m4-edge` 隔离 profile 通过：
   - action `act_8cbf995b-2a1e-4bb9-8d6e-d83db31b455c`
   - 桌面：`status=resolved / decision=desktop / outcome=allowed-once`
   - 手机再次提交：HTTP **409 conflict**，`current_status=resolved / current_decision=desktop`
   - `probe-conflict.log` 只有 1 行
   - 证据：`docs/evidence/m4-edge/conflict-desktop-first.json`
3. **插件重启后旧 pending → expired**：✅ 2026-11-15 在 `m4-edge` 隔离 profile 通过：
   - 创建 pending `act_1e78a4ba-23fd-49f2-8bcd-76522dfb05e5`；
   - 重启测试插件后再提交：HTTP **410 expired**；
   - `probe-expired.txt` 不存在，未补执行；
   - 证据：`docs/evidence/m4-edge/expired-plugin-restart.json`。
4. user-questions 的 phone answer：✅ 已在 M4-B 真机通过。

## 6 已知 UI 限制

手机审批成功后，DSH 桌面端的旧审批卡可能仍显示“等待审批”，因为 DSH client 没有广播 `approval/decided` 给其他已打开的审批 UI；任务实际已恢复运行。刷新/切换会话后桌面卡会消失。这个问题不影响审批结果，但需要在正式 M4 UI 说明或后续用 DSH 客户端事件补齐。当前 PWA 的顶部刷新只刷新任务数据，不能刷新 DSH 桌面审批卡。

## 5 安全边界

- action 只存内存，不写入 `approval-live` 或任务快照；
- 手机接口必须设备 token；
- 不提供“始终允许”；不提供跨设备重放；
- 只处理单次 `allowed-once`/`rejected`，不伪造工具结果。
