# M1 契约冻结记录（m1-v1.1）

- 冻结版本：`m1-v1.1`｜数据版本：`schema_version = "1.0"`（v1.1 只收敛状态映射，不改字段）
- 冻结时间：2026-11-05（Asia/Shanghai）；m1-v1.0 当日首次冻结，v1.1 为补充外部实测证据后的冻结修订
- 冻结范围：`contract/`、`packages/dsh-watch/lib/core/`（contract/state/normalize/store）、`packages/dsh-watch/lib/api.mjs`、`fixtures/`、测试
- 依据：`03_M0研发/CAPABILITIES.md` §7.2 + M1 专项样本 + **第三方公开实测证据**（见 `docs/evidence/external-failed-turn-research.md`）

## 1 冻结文件与哈希（sha256）

| 文件 | sha256 |
| --- | --- |
| `contract/README.md` | `8159fffef3cbe1611a882e397dc3d042bbcf1ae4d8a96424deda52874d1c331d` |
| `contract/schema/task-snapshot.schema.json` | `ba156cc194ff893c393d4508b5a71ad4260388bb883daf31740654eaedddb4fd` |
| `contract/schema/task-event.schema.json` | `f069402842552ce9a115889a57b6325423c52330d44da6c8ff9fd252fe6823c3` |
| `packages/dsh-watch/lib/core/contract.mjs` | `5b923e8558ecd16553b1f686156020724f6e0e9d0d11466ad7772d86dc7ceefa` |
| `packages/dsh-watch/lib/core/state.mjs` | `4b60a21213a26ad96492aa7d96b9e03a2104e2a7da42b3a99817f8d016970a2e` |
| `packages/dsh-watch/lib/core/normalize.mjs` | `cba7d83f5e069c703c9ec85c7ab492804a078c0f9f882a1225126237a32e9911` |
| `packages/dsh-watch/lib/core/store.mjs` | `e7dd8fde65be6e4875d1d5c2d7b0548b4308ac53fd00f07f3a109e3570722df6` |
| `packages/dsh-watch/lib/api.mjs` | `98005f1faba2009f5cf125c2828403d15796bb3b2416879077ae4a9889af4f0f` |

样本完整性哈希：`fixtures/special/provenance.json`（每份样本记录 sha256 / 来源 / `synthetic` / `external` 标记）。

## 2 样本覆盖矩阵（13 份）

| 契约分支 | 真实（本机） | 合成 / 外部依据 |
| --- | --- | --- |
| completed → succeeded | fixture-01/05、real-llm-retry | — |
| aborted → cancelled | fixture-03 | synthetic-question-aborted、synthetic-approval-outcomes(turn2) |
| error → failed | **本机 0** | synthetic-failed-turn；**external-observed-failed-turn（mimi-remote live-capture 实测：code UNKNOWN / MISSING_CREDENTIAL）** |
| max-tokens/blocked → failed | **本机 0** | external-reason-kinds（DSH 0.2.1-alpha.1 源码枚举 + 第三方收口表） |
| interrupted/forked → cancelled | **本机 0** | external-reason-kinds |
| waiting_approval（allowed-once） | fixture-02、real-multi-approval（4 次同 turn） | — |
| waiting_approval（rejected/cancelled/unavailable） | **0**（24/24 allowed-once） | synthetic-approval-outcomes |
| waiting_input（提问 tool 路径） | fixture-04、real-question-wait | synthetic-question-aborted（等待中被取消） |
| 工具错误 ≠ 失败 | fixture-01（7 次 isError 仍 completed） | — |
| LLM attempt error / retry 不误判失败 | real-llm-retry（8 次真实重试事件） | — |
| 子代理会话 depth=1 | fixture-05 | — |
| 未知 reason → unknown | 单元测试（`state.test.mjs`） | 合成/源码依据 |

## 3 验证结果（冻结时）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 单元/集成测试 | `npm test` | **40 / 40 通过**（契约 3 + fixtures 13 + 专项 10 + 状态机 10 + API 1 + 插件 3） |
| 脱敏审计 | `npm run audit:fixtures` | **13 文件 / 368 行 / 0 违规** |
| 真实样本普查 | `node tools/census-samples.mjs` | 32 会话（12 主 + 20 子代理）；completed 103 / aborted 4 / error 0；审批 24 全 allowed-once；提问 3；重试 8 |
| v1.1 API | `node tools/replay-logs.mjs` | `/v1/health` → `schema_version=1.0`、`contract=m1-v1.1`；6 会话 5,498 事件 |
| 近实时链路 | `node tools/watch-logs.mjs` | 32 日志 17,870 事件、0 错误；12 秒 +22 事件 |
| 外部证据 | 公开网络检索 | mimi-remote live-capture 夹具（2026-09-18, DSH 0.1.5-rc.2）：`turn/end.reason={kind:"error",error:{code:"UNKNOWN",message:<55字>}}`；dsh-unstuck（MIT）同款字段与 reason 枚举 |
| 证据文件 | — | `docs/evidence/tests.log`、`fixture-audit.txt`、`sample-census.json`、`api-health-v1.json`、`external-failed-turn-research.md` |

## 4 变更政策（v1.1 示例）

1. **允许**：新增可选字段/枚举值、收敛未观测分支的映射（如 v1.1 的 4 种 source-only reason），但必须同步更新 `contract/`、Schema、fixtures/测试，并在本节记录新哈希（minor 版本，如 m1-v1.2）。
2. **破坏性变更**（删字段、改语义、改必填性、改 ID 规则、改状态集合）：必须升级 `m1-v1.2+`，更新本文件与 `contract/README.md` 变更记录，M2 网关/PWA 同步升级；不得静默变更。
3. **样本**：新增真实样本必须登记 provenance；合成样本必须标注 `synthetic:true` 并写明源码依据；外部依据样本必须标注 `external:true` + 来源 URL，禁止把合成/外部样本当本机真实统计依据。
4. **一致性**：M2 的协议包、网关、PWA 必须共用本契约，不得各自演化（PRD 架构约束）。
5. **复核**：每次重采样/重新冻结需重跑 `npm test`、`npm run audit:fixtures`、`node tools/census-samples.mjs`，更新哈希与结果。

## 5 解冻 / 重开条件

- 本机观测到与契约映射不一致的真实 `turn/end`（例如新的 reason.kind、或 `error` 无 code）；
- DSH 版本升级导致事件/字段语义变化（M0 采样为 `0.2.1-rc.5`；V05 已在 `0.2.2-rc.1` 验证插件加载与事件摄取，进一步升级需重新冻结）；
- 产品需求变化导致状态/契约语义调整；
- 用户在新一轮验收中提出契约修改。

## 6 已披露风险（冻结不阻塞，但需持续跟踪）

1. **本机真实 failed 仍为 0**：但已有第三方 live-capture 实测样本确认 `error` 终态形状（mimi-remote，2026-09-18，DSH 0.1.5-rc.2），本仓库据此建立外部依据样本；建议 M1.5/M2 再用本机真实失败任务补一条**本机**样本。
2. **4 种 source-only reason（max-tokens/blocked/interrupted/forked）未在本机出现**：映射来自 DSH 0.2.1-alpha.1 源码与第三方客户端/插件的一致分析；真实出现后需复核。
3. **真实审批非 allowed-once、真实 `user-question-reply` 路径为 0**：分别由合成样本/源码字段覆盖，后续补样。
4. **未知 reason.kind 策略**：本产品保守映射为 `unknown`（不误判成功）；第三方 iOS 客户端选择“未知即失败”。差异已记录，M2 可再评估。
5. **真实 DSH 进程内加载插件：✅ 已解决（2026-11-14）**：通过 App 的 `plugin_manager` 装入 desktop profile 并热应用；真实会话与新建子代理会话均实时采集，浏览器面板可读；**DSH 重启后自动加载已确认**（uptime=9s、tasks=5）。详见 `docs/V05-ACCEPTANCE.md`。
6. **`node:sqlite` 宿主兼容**：DSH 0.2.2-rc.1（Electron 44.7 / Node 24.21.0）已验证 `node:sqlite` 可用；若未来宿主降级，插件会自动降级内存库（面板可用、重启丢历史）。

## 7 签收

- 执行：M1 研发（lead）｜完成：2026-11-05｜版本：**m1-v1.1**
- 状态：**已冻结，用户侧验收通过**（2026-11-14 真实 DSH 0.2.2-rc.1 内加载成功，见 `docs/V05-ACCEPTANCE.md`）；本机真实 failed 样本为已披露的后续补样项。
