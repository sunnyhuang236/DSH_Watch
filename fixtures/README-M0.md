# 脱敏事件样本（fixtures）字段说明

本目录 5 个 `*.jsonl` 由 `scripts/make-fixtures.mjs` 从真实 DSH 会话日志（`~/.dsh/sessions/**/session.v4.jsonl.zstd`）中截取事件窗口后重建，用于 M1 的契约、状态机与前端开发。

**这些不是内容样本**：所有正文、代码、命令参数、路径、URL、标题、ID 均已替换或删除；只保留事件结构、顺序与安全枚举值。

## 1 文件清单与来源

| 文件 | 演示内容 | 源会话（sha256 前 8 位） | 深度 | 原始 seq 窗口 | 事件数 |
| --- | --- | --- | --- | --- | --- |
| `fixture-01-completed-with-tool-errors.jsonl` | 一次成功 turn，含 7 次工具错误（说明工具报错 ≠ 任务失败） | `aac8c20a` | 0（主会话） | 299–350 | 44 |
| `fixture-02-approval-wait.jsonl` | 审批等待窗口：`tool/call → approval/asked → … → approval/decided → tool/result`，含 `job/registered/settled` | `9c3394fc` | 0（主会话） | 1154–1207 | 47 |
| `fixture-03-aborted-turns.jsonl` | 两次取消终态：`turn/end reason.kind=aborted` + `reason.reason.kind=user` | `aac8c20a` | 0（主会话） | 1020–1027、1029–1036 | 14 |
| `fixture-04-waiting-question-live.jsonl` | 提问等待窗口：`tool/call(ask_user_question)` 与 `tool/result` 间隔 52.5 秒；截取自仍在运行的会话，无 `turn/end` | `987b3f53` | 0（主会话） | 35–52 | 17 |
| `fixture-05-subagent-session.jsonl` | 子代理会话：`delegationDepth=1`、`subagent/descriptor`、`session/end-seed`，一个完整 turn | `d487a783` | 1（子代理） | 0、4–79、268 | 68 |

说明：
- `fixture-02` 从 turn 中间截取（无 `turn/start`），但包含该 turn 的 `turn/end`；消费方需允许"窗口截取、可能缺边界事件"。
- `fixture-04` 是 2026-11-04 当时仍在运行的会话快照，截到提问恢复后的 `step/end`，**没有 turn/end**，用于测试"运行中/文件末尾无终态"场景。
- 每份 fixture 的精确来源、sha256 见 `evidence/fixture-provenance.json`。

## 2 记录信封

第 1 行是会话头，其后每行一个事件：

```json
// header
{"type":"session","version":4,"id":"session-<伪 uuid>","createdAt":1767229140000,"cwd":"<workspace>","isSeeded":false,"delegationDepth":0,"agentPreset":"standard"}
// event
{"type":"turn/start","seq":0,"time":1767229200000,"data":{"turn":1}}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 事件类型；取值见第 3 节 |
| `seq` | number | 本 fixture 内从 0 连续递增；真实会话中同样是全局递增序号（28 个会话已验证无缺口、无重复） |
| `time` | number | epoch 毫秒；已重定基（基准 `2026-01-01T00:00:00Z`，每个 fixture 再加 1 小时偏移），保留相对间隔 |
| `data` | object | 事件负载，见第 3 节 |
| `surfaceOp` | string? | 仅 `assistant/message`、`tool/result`、`user/message`、`system/message` 出现，本轮观察值均为 `append` |
| `sourceEventSeqs` | number[]? | 仅 `tool/result` 出现，指向对应 `tool/call` 的 seq（本图中已重编号） |

## 3 主要事件字段

### 3.1 生命周期

| 事件 | 字段 | 说明 |
| --- | --- | --- |
| `turn/start` | `data.turn` (number) | 本会话内轮次号，从 1 递增；无独立字符串 `turn_id` |
| `step/start` / `step/end` | `data.turn`, `data.step` (number) | 轮次内的步骤号，从 1 递增 |
| `turn/end` | `data.turn`, `data.reason.kind` (string), `data.reason.reason.kind`? (string) | 终态：本轮实测 `completed` / `aborted`；`aborted` 附带 `reason.reason.kind=user` |

### 3.2 消息与用量

| 事件 | 字段 | 说明 |
| --- | --- | --- |
| `user/message` | `data.id`, `data.role`, `data.content[].type`, `data.content[].text`, `data.source.kind`, `data.source.rpcId`, `data.source.clientTimeZone`? | `source.kind` 区分来源：真实用户、`runtime-context`、`skill-catalog`、`time-context`、`agent-message`、`subagent-settled` 等（见 CAPABILITIES 报告） |
| `system/message` | `data.turn`, `data.step`, `data.message.role`, `data.message.content[].text`, `data.message.source.kind` | 系统提示词，只在 turn 首步出现 |
| `assistant/message` | `data.turn`, `data.step`, `data.message.{role,content[],source{kind,provider,model},id}`, `data.usage.{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens}` | `content[].type` 可为 `reasoning` / `text` / `tool-call`；`usage` 是 token 数，不含金额/币种 |
| `agent/inbox/spliced` | `data.target`, `data.start`, `data.inserted[].{content[],source,role,id}` | 向主代理收件箱插入消息（含真实用户消息、通知等）；与 `user/message` 存在同一消息的重复表示 |

### 3.3 工具

| 事件 | 字段 | 说明 |
| --- | --- | --- |
| `tool/call` | `data.turn`, `data.step`, `data.callId` (string, `call_…`), `data.name` (string), `data.arguments` (string，JSON 文本) | 工具调用；`arguments` 为 JSON 字符串 |
| `tool/result` | `data.turn`, `data.step`, `data.message.{role,source{kind,callId},toolCallId,content[],isError,id}`, `data.meta` | `isError` 表示工具执行失败，但**不一定**导致 turn 失败；`meta` 因工具而异（如 `meta.opsShell.exitCode`、`meta.statusCode`、`meta.truncated` 等） |

### 3.4 审批

| 事件 | 字段 | 说明 |
| --- | --- | --- |
| `approval/asked` | `data.id`, `data.toolName`, `data.callId`, `data.reason` (string，给人看的原因) | 审批请求发起；`callId` 与对应 `tool/call` 相同 |
| `approval/decided` | `data.id`, `data.outcome` (string) | 审批结果；本轮 28 个会话中 21 次全部为 `allowed-once` |

### 3.5 后台任务与其它

| 事件 | 字段 | 说明 |
| --- | --- | --- |
| `job/registered` | `data.jobId`, `data.owner`, `data.kind`, `data.label`, `data.startedAt` | 后台任务登记（如 bash/pwsh 作业） |
| `job/settled` | 上述 + `data.finishedAt`, `data.status`, `data.cause`, `data.producerReported`, `data.detail` | 后台任务结束；`status` 观察值 `completed` / `killed` |
| `goal/change` | `data.kind`, `data.goal.{id,revision,objective,phase,maxGoalRounds}`, `data.roundsStarted` | goal 状态变化（注意持久化名是 `goal/change`，不是 `goal/changed`） |
| `session/title` | `data.title`, `data.messageSeqs`, `data.source.kind` | 会话标题（含 LLM 生成） |
| `team/member` / `team/task` | `data.teamId` + `data.member{...}` / `data.task{id,revision,subject,status...}` | Agent Teams 成员与共享任务 |
| `subagent/descriptor` / `subagent/catalog` | `data.mode`, `data.provider`, `data.agentProvider/agentModel/agentReasoningEffort` / `data.childId` | 子代理描述与子会话目录 |
| `session/end-seed` | 无字段 | 会话结束标记（内部语义未在源码层确认） |
| `workspace/changes` | `data.turn` | 该 turn 有工作区文件变更 |
| `todo/write` | `data.todos[].{content,status}` | todo 列表快照 |
| `deliverables/presented` | `data.turn`, `data.callId`, `data.files[].{path,description}` | `present` 工具产物 |
| `permission/preset` / `sandbox/mode` / `approval/policy` | `data.preset` / `data.mode`+`data.source` / `data.policy`+`data.source` | 会话初始配置，通常在 seq 0–2 |

## 4 脱敏规则

1. **ID 伪名化**：session id、message id、approval id、callId、jobId、teamId、childId、rpcId 等用固定盐的 sha256 生成确定性假值；主会话 id 保留 `session-<uuid>` 形状。
2. **字符串替换**：除安全枚举（`type`/`kind`/`status`/`outcome`/`role`/`provider`/`model`/`policy`/`preset`/`mode`/`phase` 等）外，所有字符串替换为 `"<redacted:N chars>"`，保留长度信息。
3. **时间重定基**：`time`/`startedAt`/`finishedAt`/`createdAt` 平移为 2026-01-01 起的假时间，保留相对间隔。
4. **删除内部/大字段**：`data.stream`、`data.message.source.replayState`；整条删除 `request/header`、`request/context`、`session/title-llm-request`、`web/deepseek-search-llm-request`、`session-log-deepseek/delivery-accepted`、`compaction/summary`。
5. **seq 重编号**：窗口内事件重新从 0 连续编号；`sourceEventSeqs` 与 `session/title.messageSeqs` 同步映射。

## 5 审计结果

`node scripts/audit-fixtures.mjs` 结果：**PASS**（5 文件 / 195 行 / 0 违规）。检查项：ASCII-only、无盘符路径、无 URL/邮箱、无 token/密钥特征、无中文、无原始会话 ID 或目录名、字符串长度 < 200、JSON 可解析、seq 连续、header 唯一。报告：`evidence/fixture-audit.txt`。

## 6 复现与使用限制

```bash
cd 03_M0研发
node scripts/make-fixtures.mjs      # 重新生成（只读源日志；输出写入 fixtures/）
node scripts/audit-fixtures.mjs     # 脱敏审计
```

- 仅用于 M1 的契约/状态机/前端开发，**不可作为真实内容或真实统计依据**。
- DSH 为开发者预览，字段可能变化；M1 联调前应以当时 DSH 版本重新采样。
- fixture 只截取窗口，事件集合不完整（例如 fixture-02 无 `turn/start`、fixture-04 无 `turn/end`），消费方需容忍缺边界事件。
