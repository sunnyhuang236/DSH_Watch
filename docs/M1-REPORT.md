# M1 数据管道报告（M1 完成；契约 m1-v1.1 已冻结）

日期：2026-11-05（M1 完成）；2026-11-14 补充 V05 真实加载与重启验收｜执行：M0 之后续作（lead）｜代码：`dsh-mobile-watch/`

## 0 结论

**M1 完成并冻结：契约 m1-v1.1、`dsh-watch` 插件、本地库、只读 API、浏览器调试面板、42 项测试全绿、13 份回归样本、脱敏审计 0 违规。** 本机真实 failed 仍为 0，但已通过公开网络找到**第三方 live-capture 实测样本**确认 failed 终态字段形状，并据此补齐外部依据样本与 reason 映射。

| 项 | 状态 |
| --- | --- |
| WP02 契约冻结（JSON Schema + 实现常量 + 校验器） | ✅ 冻结 **m1-v1.1**（哈希见 `docs/M1-FREEZE.md`） |
| WP03 插件（订阅/归一化/状态机/本地库/只读 API/调试面板） | ✅ `packages/dsh-watch/` |
| 专项样本：failed / 审批 / 提问 | ✅ 13 份（本机真实 5 + 真实窗口 3 + 合成 3 + 外部依据 2） |
| 外部实测证据（网上检索） | ✅ mimi-remote live-capture 夹具 + dsh-unstuck（MIT）→ `docs/evidence/external-failed-turn-research.md` |
| 回归 | ✅ 42 项测试；脱敏审计 13 文件/368 行/0 违规 |
| **真实 DSH 进程内加载插件** | ✅ **V05 通过**：DSH 0.2.2-rc.1 内热加载，API/面板/实时摄取均验证；**重启后自动加载已确认**（uptime=9s、tasks=5，见 `docs/V05-ACCEPTANCE.md` §3.8） |
| **本机真实 `failed` 终态** | ⚠️ 仍为 0（32 会话 / 107 turn/end）；已由外部实测确认形状，建议 M1.5 补本机样本 |

---

> 版本说明：M0 采样与 M1 契约依据为 DSH `0.2.1-rc.5`；V05 真实加载时运行环境已升级到 `0.2.2-rc.1`，插件加载、事件摄取与 API 均已在该版本验证通过。

## 1 交付物

| 路径 | 内容 |
| --- | --- |
| `contract/README.md` + `contract/schema/*.json` + `contract/validate.mjs` | 冻结契约 m1-v1.1：ID、状态机、`turn/end.reason`（7 种）、approval outcome、事件、错误码、兼容/变更规则 |
| `packages/dsh-watch/` | DSH host 插件包（`dsh.bundle.patch`、`cordis.patch.yml`、`dsh.plugin.json`） |
| `packages/dsh-watch/lib/core/` | contract / normalize / state / store / pipeline / redact |
| `packages/dsh-watch/lib/{api,panel,runtime,index}.{mjs,js,html}` | 只读 API、调试面板、运行时、Cordis 入口 |
| `tools/replay-logs.mjs` / `tools/watch-logs.mjs` | 免安装回放 / 近实时 tail → 调试面板 |
| `tools/census-samples.mjs` | 真实样本普查（失败/审批/提问/重试覆盖度） |
| `tools/make-special-fixtures.mjs` + `tools/redact-session.mjs` | 专项样本生成（真实窗口脱敏 + 合成 + 外部依据） |
| `tools/audit-fixtures.mjs` | 全量 fixtures 脱敏审计 |
| `fixtures/` + `fixtures/special/` | 13 份样本 + `provenance.json`（来源/sha256/synthetic/external 标记） |
| `docs/M1-FREEZE.md` | 冻结记录：m1-v1.1 哈希、覆盖矩阵、变更政策、风险 |
| `docs/evidence/` | 测试、普查、样本生成/审计、回放/实时/API 证据、外部检索记录 |

## 2 对齐验收（WP02/WP03）

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 事件订阅 | `session/event`(global) + `agent/status` + `agent/error` + `goal/changed` | `lib/index.js`、`test/plugin-adapter.test.mjs`（3） |
| 归一化 | DSH 持久事件 → 18 类 TaskEvent；忽略内部事件；不落完整正文/工具参数/路径；仅保留真人消息 ≤80 字脱敏标题截断与 `text_len` | `lib/core/normalize.mjs` |
| 状态机 | 7 种 reason 映射；终态按 run 不可逆；工具报错不改变状态；未知 reason→unknown | `lib/core/state.mjs`、`test/state.test.mjs`（10） |
| 契约与样本 | 13 份 fixtures 全部通过、Schema 校验、重复回放幂等 | `contract.test.mjs`（3）、`fixtures.test.mjs`（13）、`special.test.mjs`（10） |
| 本地库 | `node:sqlite` tasks/events；`event_id=session:seq` 幂等 | `lib/core/store.mjs` |
| 只读 API | `/v1/health`、`/v1/tasks`、`/v1/tasks/{id}`、`/v1/tasks/{id}/events`；v1.1 contract | `test/api.test.mjs`（1） |
| 浏览器调试面板 | `http://127.0.0.1:7317/`：任务/快照/事件，2s 刷新 | `lib/panel.html`、`docs/evidence/panel/panel-final.png` |
| **真实 DSH 内加载（V05）** | 插件在 DSH 0.2.2-rc.1 进程内热加载；4 个已有任务 seed、新建子代理任务实时出现（depth=1，running→succeeded）、浏览器面板可见 | `docs/V05-ACCEPTANCE.md`、`docs/evidence/v05/` |
| 实时看到任务与事件流 | 回放 6 会话 5,498 事件；tail 32 日志 17,870 事件、12 秒 +22 | `docs/evidence/` |

```bash
cd dsh-mobile-watch && npm test
# ℹ tests 41 / pass 41 / fail 0
```

## 3 专项样本与外部实测（M1 新增）

本机真实样本普查（`tools/census-samples.mjs`，32 会话）：

| 分支 | 本机真实数量 | 处理 |
| --- | --- | --- |
| `turn/end completed` / `aborted` | 103 / 4（全 user） | 真实样本覆盖（fixture-01/03/05、real-llm-retry） |
| **`turn/end error`（failed）** | **0 / 107** | 合成 + **外部实测依据样本**（见下） |
| 审批 `allowed-once` | 24（6 会话） | 真实样本（fixture-02、real-multi-approval 4 次同 turn） |
| **审批 `rejected/cancelled/unavailable`** | **0** | 合成 `synthetic-approval-outcomes`（源码 OUTCOMES 闭集） |
| 提问等待（tool 路径） | 3 次（最长 52.5s） | 真实样本（fixture-04、real-question-wait） |
| 等待提问中被取消 | 0 | 合成 `synthetic-question-aborted` |
| LLM attempt error / retry | 8 次（真实） | 真实样本 `real-llm-retry`（不误判 failed） |
| **max-tokens/blocked/interrupted/forked** | **0** | 外部源码依据样本 `external-reason-kinds` |

**网上找到的关键证据（failed 终态）**：第三方 DSH iOS 客户端 **mimi-remote** 的 live-capture 契约夹具（`capturedAt 2026-09-18`，DSH `0.1.5-rc.2`）中 `turnEndReasonsObserved` 含
`{"kind":"error","error":{"message":"<str:55>","code":"UNKNOWN"}}`；commit `c552683` 说明另实测 `MISSING_CREDENTIAL`；`dsh-unstuck`（MIT）生产插件按同款 `{kind:'error',error:{code,message}}` 与 `max-tokens/interrupted` 等枚举处理。详见 `docs/evidence/external-failed-turn-research.md`（只引用事实，未复制第三方文件；样本为本仓库自建并标注 `external:true`）。

新增样本：`external-observed-failed-turn.jsonl`（error→failed，UNKNOWN/MISSING_CREDENTIAL 两种 code）、`external-reason-kinds.jsonl`（max-tokens/blocked→failed，interrupted/forked→cancelled）。

## 4 契约冻结要点（m1-v1.1）

见 `contract/README.md` 与 `docs/M1-FREEZE.md`，要点：

1. `task_id=session_id`、`run_id=session_id:turn`、`event_id=session_id:seq`；无独立 turn_id/event_id。
2. 状态含 `unknown`；终态按 run 不可逆；工具报错不改变状态；未知 reason 不误判成功。
3. `turn/end.reason`：`completed`；`aborted{reason.kind}`；`error{error:{message,code}}`（message 不落库、只留 error_code）；`max-tokens`；`blocked`；`interrupted`；`forked`。
4. 映射：`completed→succeeded`；`aborted/interrupted/forked→cancelled`；`error/max-tokens/blocked→failed`；其他/缺失→`unknown`。
5. `cost` 固定 null；`token_usage` 表达 token；`waiting` 表达等待；`agent_state` 只表达实时 idle/running。
6. 兼容：允许新增可选字段/收敛未观测映射（minor）；破坏性变更升 m1-v1.2+；M2 网关/PWA 共用。

## 5 验证证据

| 证据 | 结果 | 文件 |
| --- | --- | --- |
| 单元/集成测试 | **42 项全绿**（契约 3 + fixtures 13 + 专项 10 + 状态机 10 + API 1 + 插件 4 + 存储保留 1） | `docs/evidence/tests.log` |
| 脱敏审计 | **13 文件 / 368 行 / 0 违规** | `docs/evidence/fixture-audit.txt` |
| 真实样本普查 | 32 会话（12 主 + 20 子代理）、103 completed/4 aborted/0 error、24 审批、3 提问、8 重试 | `docs/evidence/sample-census.json` |
| v1.1 API | 6 会话 5,498 事件；`/v1/health` → `schema_version=1.0`、`contract=m1-v1.1` | `docs/evidence/api-health-v1.json`、`api-task-sample-v1.json` |
| 近实时 tail | 32 日志 17,870 事件、0 错误；12 秒 +22 | `docs/evidence/watch-*.json`、`watch-console.txt` |
| 专项样本 | 8 份 special（3 真实窗口 + 5 合成，其中 2 份外部依据），provenance 含 sha256/来源/标记 | `fixtures/special/provenance.json`、`special-fixtures.log` |
| 外部检索 | mimi-remote live-capture + dsh-unstuck（MIT）→ failed 形状与 reason 枚举 | `docs/evidence/external-failed-turn-research.md` |

## 6 未完成 / 需要你操作

1. **真实 DSH 内加载插件：✅ 已完成（V05）**：`dsh-watch` 已通过 App 的 `plugin_manager` 装入 desktop profile 并热应用，**DSH 重启后自动加载已确认**（2026-11-14 晚，uptime=9s、tasks=5）；详见 `docs/V05-ACCEPTANCE.md`。
2. 本机真实 `failed` 样本：已由外部实测确认形状，建议 M1.5/M2 用本机真实失败任务再补一条；如与契约不符按变更政策升 m1-v1.2。
3. 真实审批非 allowed-once、真实 `user-question-reply`、4 种 source-only reason 的本机样本：后续真实场景补样。
4. 审批/提问 waterfall hook 包装、手机审批、推送属 M2/M4；M1 只读。

## 7 环境问题与处理（本轮踩坑）

1. 隔夜会话恢复后 DSH 沙箱临时目录被清理 → `ops_bash` 报 `EXECUTOR_UNAVAILABLE`；重建临时目录后恢复（非项目代码问题）。
2. 沙箱禁止 spawn 子进程 → `node --test` 使用 `--test-isolation=none`（已写入 `npm test`）。
3. Windows 中文路径 + ESM/`node:sqlite`/`node:http` 正常；zstd 多帧日志整体解压与 tail 增量拼接均验证通过。

## 8 安全与合规

- 只写 `dsh-mobile-watch/`；未修改 `01_交付物/`、DSH 源码、`~/.dsh` 配置与原始日志；未安装第三方插件；未写凭证；未联网上传数据（外部检索为只读 web 请求）。
- 插件/工具只监听 `127.0.0.1`；数据库存归一化数据（标题为真人消息 ≤80 字脱敏截断；摘要为状态文案；不含完整正文/工具参数/审批原因/路径原文）；`fixtures` 全量审计通过。
- `tools/asar-read.mjs`/`tools/asar-search.mjs` 只读源码，不修改 `app.asar`。

## 9 下一步

1. 你确认 App 插件页安装方式 → 我出改动清单/回滚 → 完成真实链路验收（V05 收尾）。
2. 本机真实失败任务补一条样本（M1.5/M2）；如有新 reason.kind 则按政策升 m1-v1.2。
3. 进入 **M2**：网关 + 配对 + PWA + Web Push，复用冻结的 `contract/`。

## 附：复跑命令

```bash
cd dsh-mobile-watch
npm test                          # 42 项测试
npm run audit:fixtures            # 脱敏审计（13 文件）
npm run special:fixtures          # 重新生成专项样本（真实窗口脱敏 + 合成 + 外部依据）
node tools/census-samples.mjs     # 真实样本普查
node tools/replay-logs.mjs        # 回放 + http://127.0.0.1:7317/
node tools/watch-logs.mjs         # 近实时 + 同一面板
```
