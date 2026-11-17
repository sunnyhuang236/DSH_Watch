# 外部检索：DSH failed 终态的真实证据（M1 补充）

日期：2026-11-05｜目的：本机 32 个真实会话、107 个 turn/end 中 `failed` 仍为 0，按用户要求到公开网络寻找真实 failed 终态证据。以下是检索结果与采用方式；**只引用事实，未复制第三方文件内容**。

## 1 找到的证据

### 1.1 mimi-remote（第三方 DSH iOS 客户端，真实 live-capture 夹具）

- 仓库：<https://github.com/gaixianggeng/mimi-remote>
- 关键 commit：`c552683df3355e28beee5bcd0ec326e24c865191`（“fix(ios): DeepSeek 回合出错结束时按失败收口并显示原因”，Refs #861）
  <https://github.com/gaixianggeng/mimi-remote/commit/c552683df3355e28beee5bcd0ec326e24c865191>
- commit message 明确写：
  - `turn/end.reason.kind` 为 `error` 时原先被当成完成；现在按失败收口；
  - **实测**原因包含 `error`；示例为路由缺少凭据 `MISSING_CREDENTIAL`；
  - 源码另有 4 种：`max-tokens`、`blocked`、`interrupted`、`forked`（0.2.1-alpha.1）；
  - 新增 `HarnessTurnEndReason` 与 `HarnessTurnFailureSettlementTests`。
- 该仓库的契约夹具 `contracts/harness-native/fixtures/stream/durable-events.json`（provenance.level = `live-capture`，DSH `0.1.5-rc.2`，capturedAt `2026-09-18`）里 `turnEndReasonsObserved` 的值为：
  ```json
  [{"kind":"completed"},
   {"kind":"error","error":{"message":"<str:55>","code":"UNKNOWN"}},
   {"kind":"aborted","reason":{"kind":"user"}}]
  ```
- 其 `assistant-stream.json` 的 `endOutcomeEvidence.table` 还有一行“工具回合 error”：`turnEnd = {"kind":"error","error":{"code":"UNKNOWN"}}`（error 可以**没有 message**，只留 code）。
- 许可证：仓库 API 显示 `NOASSERTION`（未声明标准许可证）→ 本仓库**只引用上述事实与 URL**，不复制其文件/代码；样本为本仓库自建。

### 1.2 dsh-unstuck（MIT，生产用 DSH 监督插件）

- 仓库：<https://github.com/Chlyz621/dsh-unstuck>
- README：把“异常结束”定义为 `turn/end` 原因 `error`、`aborted`（非用户取消）、`max-tokens`、`interrupted`；并明确“用户按停止/正常完成/永久错误不续跑”。
- `lib/core.js`（MIT）给出同款字段形状与真实观察：
  - `{ kind: "error", error: { code, message } }`；
  - `{ kind: "aborted", reason: "user" }` 与 `{ kind: "aborted", reason: { kind: "hook" | "disposed" } }`（cause 兼容字符串/对象）；
  - `ABNORMAL_KINDS = ["error","aborted","max-tokens","interrupted"]`；`blocked`/`forked` 不自动续跑；
  - 真实观察：8 次 `aborted{kind:'user'}` 全为零输出；`completed` 里存在“假完成”等。
- `test/core.test.js` 用同一批事件形状做断言（`{kind:"error",error:{code:"network_error",message:"x"}}` 等）。
- 许可证：MIT（可引用；本仓库仍为自建样本）。

### 1.3 DSH 上游与社区

- DSH 仓库（MIT）：<https://github.com/deepseek-ai/deepseek-harness>（默认分支 `master`）。
- 本机 M0 采样版本（DSH `0.2.1-rc.5`）的 `dsh-agent-loop` 源码同样构造 `turn/end` reason：`completed`、`aborted+reason`、`error+error{message,code}`（本仓库 M0 证据 `evidence/dsh-source-facts.md`）；第三方对 `0.2.1-alpha.1` 的分析补出 `max-tokens/blocked/interrupted/forked`。V05 时运行环境已升级到 `0.2.2-rc.1`，插件加载与事件摄取已验证。
- 相关公开讨论（现象侧）：#2900（工具崩溃后回合结束/悬空 tool_calls）、#2661（scheduler error）、#682（无限重试）；说明 failed/异常终态在真实世界确实发生，只是本机样本未覆盖。

## 2 采用结论（m1-v1.1）

1. `error` 终态字段形状获得**第三方 live-capture 实测**确认：
   `{ "kind": "error", "error": { "message"?: string, "code": "UNKNOWN" | "MISSING_CREDENTIAL" | … } }`；
   message 可能缺失 → 产品侧失败原因必须能退回 code。
2. reason 枚举扩展为：`completed / aborted / error / max-tokens / blocked / interrupted / forked`；
   映射：`error|max-tokens|blocked → failed`，`aborted|interrupted|forked → cancelled`，`completed → succeeded`，其他 → `unknown`（保守，不误判成功）。
3. 本机仍无 failed 真实样本；新增两份**外部实测依据样本**（自建、标注 `synthetic: true` + `external: true` + source/URL）：
   - `fixtures/special/external-observed-failed-turn.jsonl`：`error`（code UNKNOWN / MISSING_CREDENTIAL）两轮；
   - `fixtures/special/external-reason-kinds.jsonl`：4 种源码 reason 的映射。
4. 契约与冻结记录升级为 **m1-v1.1**（只收敛状态映射，不改冻结字段）。

## 3 链接清单

- mimi-remote commit：<https://github.com/gaixianggeng/mimi-remote/commit/c552683df3355e28beee5bcd0ec326e24c865191>
- mimi-remote 夹具（live-capture）：<https://github.com/gaixianggeng/mimi-remote/blob/c552683df3355e28beee5bcd0ec326e24c865191/contracts/harness-native/fixtures/stream/durable-events.json>
- mimi-remote 失败收口测试：<https://github.com/gaixianggeng/mimi-remote/blob/c552683df3355e28beee5bcd0ec326e24c865191/ios/MimiRemote/Tests/MimiRemoteTests/HarnessTurnFailureSettlementTests.swift>
- dsh-unstuck README：<https://github.com/Chlyz621/dsh-unstuck>
- dsh-unstuck core（MIT）：<https://github.com/Chlyz621/dsh-unstuck/blob/main/lib/core.js>
- dsh-unstuck 测试：<https://github.com/Chlyz621/dsh-unstuck/blob/main/test/core.test.js>
- DSH 仓库：<https://github.com/deepseek-ai/deepseek-harness>
