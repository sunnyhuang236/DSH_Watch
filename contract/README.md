# M1 契约（m1-v1.1，已冻结）

- 契约版本：`m1-v1.1`（M1 冻结；在 m1-v1.0 基础上补充第三方实测 failed 终态与 4 种 DSH 源码 reason 映射）
- 数据版本：`schema_version = "1.0"`（v1.1 只收敛状态映射，不改快照/事件字段）
- 冻结日期：2026-11-05（专项样本补齐后；v1.1 同日补外部实测证据）
- 冻结哈希与覆盖矩阵：见 `docs/M1-FREEZE.md`
- 实现常量唯一来源：`packages/dsh-watch/lib/core/contract.mjs`；JSON Schema：`schema/`；校验器：`validate.mjs`

本契约依据 `03_M0研发/CAPABILITIES.md` §2/§7.2、M1 补充样本（`fixtures/special/`）与第三方公开实测（mimi-remote live-capture 夹具、dsh-unstuck 生产插件）冻结。

## 1 标识

| 字段 | 规则 | 依据（M0/M1） |
| --- | --- | --- |
| `task_id` | DSH session id：主会话 `session-<uuidv4>`；子代理会话 `<uuidv4>` | DSH 无 session_id 列，取 header.id |
| `run_id` | `task_id + ':' + turn`（turn 为会话内整数，从 1 递增） | DSH 无 turn_id；单数字跨会话冲突 |
| `event_id` | `task_id + ':' + seq`（seq 为会话内 0 起连续序号） | DSH 无 event_id 列；真实/专项样本重复回放均幂等 |
| `seq` | 原样保留 DSH `seq`，按 run 单调 | 跨会话不可比；同一事件重复重放时靠 event_id 去重 |

## 2 状态机

### 2.1 状态（TaskSnapshot.state）

| 状态 | 进入条件 | 退出条件 |
| --- | --- | --- |
| `unknown` | 任务已建立但尚无 turn/step；或未知 `turn/end` reason | 出现 `turn/start` / `step/start` |
| `running` | `turn/start`；或从等待恢复 | `turn/end`；进入等待 |
| `waiting_approval` | 收到 `approval/asked` 未决 | `approval/decided`；`turn/end` |
| `waiting_input` | 提问工具 `tool/call` 未返回（M1 支持 `ask_user_question`） | 对应 `tool/result`；`turn/end` |
| `succeeded` | `turn/end.reason.kind = completed` | 新 run（新 `turn/start`）开始 |
| `failed` | `turn/end.reason.kind = error`，或实时 `agent/error` | 新 run 开始 |
| `cancelled` | `turn/end.reason.kind = aborted` | 新 run 开始 |

规则：
1. **终态按 run 不可逆**；同一 run 的终态之后只记录事件，不改状态；新 `turn/start` 开启新 run 并允许重新 `running`（样本：`fixture-03`、`special/synthetic-approval-outcomes`）。
2. 未知 `reason.kind` 一律落 `unknown` 并写 `diagnostic` 事件，**不得**当作 succeeded。
3. 工具报错（`tool/result.isError`）不改变任务状态（真实样本 `fixture-01`：7 次工具错误后仍 succeeded）。
4. `agent/status` 只影响 `agent_state`（idle/running），不代表任务状态。
5. 等待解除必须撤销未投递提醒（M2 落地）。

### 2.2 `turn/end.reason`（DSH 源码形状；m1-v1.1 补全）

| reason.kind | 载荷 | 语义 | 映射 | 证据 |
| --- | --- | --- | --- | --- |
| `completed` | 无 | 正常完成 | `succeeded` | 真实：103 次（fixture-01/05、real-llm-retry） |
| `aborted` | `reason.kind`（如 `user`） | 用户/宿主取消 | `cancelled` | 真实：4 次（全部 user，fixture-03） |
| `error` | `error:{message, code}`；**message 不落产品库**，仅保留 `error_code` | 上游错误 | `failed` | 本地真实 0；**外部实测**：mimi-remote live-capture（2026-09-18, DSH 0.1.5-rc.2）`turnEndReasonsObserved` 含 `{kind:"error", error:{message:<55字>, code:"UNKNOWN"}}`，另实测 `MISSING_CREDENTIAL`；样本 `special/external-observed-failed-turn` |
| `max-tokens` | 无额外 error | 单次输出触到上限、回复被截断 | `failed`（`error_code=MAX_TOKENS`） | DSH 0.2.1-alpha.1 源码枚举；mimi-remote #861 收口表、dsh-unstuck `ABNORMAL_KINDS` 一致；样本 `special/external-reason-kinds` |
| `blocked` | 无额外 error | 轮次前置检查拒绝继续 | `failed`（`error_code=BLOCKED`） | 同上 |
| `interrupted` | 无额外 error | 旧格式迁移给未收尾轮次补写 | `cancelled` | 同上 |
| `forked` | 无额外 error | 分叉种子给继承的未完成轮次补写 | `cancelled` | 同上 |
| 其他/缺失 | — | 未知终态 | `unknown`（未知 kind） | 保守策略：不误判为成功；与 mimi-remote 的"未知即失败"不同，已在风险中披露 |

说明：`max-tokens/blocked/interrupted/forked` 在 M0 采样（DSH 0.2.1-rc.5）的本机日志中未观测到；来源为第三方对 DSH 源码与真实日志的独立验证（见 `docs/evidence/external-failed-turn-research.md` 的链接与引用）。V05 已在 DSH 0.2.2-rc.1 上验证插件加载与事件摄取。

### 2.3 审批结果（approval/decided.outcome）

源码闭集：`allowed-once | rejected | cancelled | unavailable`（`dsh-user-approval/lib/types/index.js`）。

- 真实样本 24 次全部 `allowed-once`（等待统计：中位 26.9s、最长 1665s）。
- `rejected/cancelled/unavailable` 由 `special/synthetic-approval-outcomes` 覆盖（合成、按源码枚举构造）。
- 无论 outcome 为何，`approval/decided` 都解除 `waiting_approval`；任务是否继续由后续 `turn/end` 决定。

### 2.4 提问（user questions）

- 源码 hook 名为 `user-questions/request`（无持久事件）；真实提问回复为延迟 `user/message`，`source.kind = "user-question-reply"`（含 `callId`、`outcome: "answered"`）。
- 本机真实日志中该路径 **0 次**；M1 的 wait 判定以 `tool/call(ask_user_question)` → `tool/result` 窗口为准（真实样本 3 次，最长 52.5s）。
- 源码限制：子代理不能发起人工提问。

## 3 快照扩展字段（相对 PRD §9.1 的 M1 增补）

`ended_at`、`waiting{kind,since,call_id,approval_id,tool_name}`、`current_step`、`current_tool`、`token_usage`、`agent_state`、`delegation_depth`、`parent_task_id`、`origin`。`cost` 固定 `null`（M0：无金额/币种）。

## 4 事件类型（归一化后）

`run_started`、`run_finished`、`step_started`、`step_finished`、`tool_started`、`tool_finished`、`assistant`、`user_message`、`approval_requested`、`approval_decided`、`job_started`、`job_finished`、`title`、`subagent`、`team`、`goal`、`diagnostic`、`unknown`。

- `run_finished.payload`：`{ turn, reason_kind, reason_detail, error_code }`（error_code 仅 `turn/end.error` 时存在）。
- 不含用户正文、工具参数、审批原因原文；只保留长度/枚举/计数。
- DSH 内部事件（`request/header`、`delivery-accepted`、`compaction/*`、`session/end-seed` 等）直接忽略，不进库。
- 子代理会话作为独立任务入库（`delegation_depth=1`、`parent_task_id` 若有）。

## 5 错误码（/v1）

| HTTP | code | 说明 |
| --- | --- | --- |
| 400 | `bad_request` | 参数不合法 |
| 404 | `not_found` | 任务/路径不存在 |
| 405 | `method_not_allowed` | 只允许 GET |
| 500 | `internal_error` | 未预期错误 |

错误体：`{ "error": { "code": "...", "message": "..." } }`。

## 6 冻结与兼容规则

- **已冻结（m1-v1.0）**：字段、状态、事件类型不再随意改动。允许**新增可选字段**（向后兼容，需更新 `schema/` 与版本说明）；删除字段、改语义、改必填性属于破坏性变更。
- 破坏性变更必须升级到 **m1-v1.1+**，更新 `docs/M1-FREEZE.md` 与 `CHANGELOG` 段，并同步更新 fixtures/测试；M2 网关与 PWA 依赖本契约，不得各自演化。
- `schema_version` 必填；未知 DSH 事件忽略并写 `unknown` 诊断，不误判完成。
- 快照字段缺失一律 null（不显示 0），与 PRD §9.1 一致。
- 契约文件哈希见 `docs/M1-FREEZE.md`；重采样/重新冻结需记录新哈希。

## 7 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| 0.1（草案） | 2026-11-04 | 依据 M0 能力报告建立 ID/状态/事件/错误码草案；fixtures 5 份真实样本 |
| 1.0（冻结） | 2026-11-05 | 补专项样本（failed / 审批 rejected·cancelled·unavailable / 等待提问被取消 / 真实多审批 / 真实 LLM 重试）；明确 `turn/end.reason` 与 approval outcome 源码枚举；`run_finished` 增加 `error_code`；状态机与测试覆盖；冻结契约与哈希 |
| 1.1（冻结修订） | 2026-11-05 | 补第三方公开实测的 failed 终态（`error+code`）与 4 种源码 reason（`max-tokens/blocked/interrupted/forked`）映射；样本增至 13 份；状态映射收敛、测试扩展；更新冻结哈希 |

## 8 样本与验证

- 样本：`fixtures/`（M0 真实 5 份）+ `fixtures/special/`（真实窗口 3 份 + 合成 3 份，含 `provenance.json`）。
- 验证：`npm test`（41 项）、`npm run audit:fixtures`（脱敏审计）、`node tools/census-samples.mjs`（真实样本普查）。
- 详情：`docs/M1-FREEZE.md`、`docs/M1-REPORT.md`。
