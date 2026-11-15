# fixtures（事件样本）

本目录是 M1 契约与状态机的回归样本，**全部为脱敏/构造数据，不是真实内容样本**。

```
fixtures/
  fixture-01..05-*.jsonl     M0 从真实会话截取的 5 份样本（字段说明见 README-M0.md）
  special/                   M1 专项样本（覆盖 failed/审批/提问边界）
    real-multi-approval-window.jsonl     真实：同一 turn 内 4 次审批（allowed-once）
    real-question-wait-window.jsonl      真实：提问等待窗口（ask_user_question）
    real-llm-retry-window.jsonl          真实：LLM error-again 与 llm/retry（turn 仍完成）
    synthetic-failed-turn.jsonl          合成：turn/end reason.kind=error → failed
    synthetic-approval-outcomes.jsonl    合成：rejected / cancelled / unavailable 三种 outcome
    synthetic-question-aborted.jsonl     合成：等待提问期间被取消
    external-observed-failed-turn.jsonl  外部实测依据：mimi-remote live-capture 的 error 终态（code UNKNOWN / MISSING_CREDENTIAL）
    external-reason-kinds.jsonl          外部源码依据：max-tokens/blocked/interrupted/forked 映射
    provenance.json                      每份样本的来源、sha256、synthetic/external 标记、期望状态
```

## 真实窗口 vs 合成 / 外部样本

- **真实窗口**（`real-*`）：从本机 `~/.dsh/sessions` 只读截取 seq 窗口，经脱敏后写入：
  - ID 伪名化、时间重定基、seq 重编号；
  - 正文/工具参数/路径/URL/标题等替换为 `<redacted:N chars>`；
  - 精确来源与 sha256 见 `special/provenance.json`。
- **合成样本**（`synthetic-*`）：本机未观测到的分支，按 DSH 源码中的事件/字段形状构造（见 `provenance.json` 的 `note`），仅用于状态机覆盖；**不得**当作真实统计依据。
- **外部实测依据样本**（`external-*`，标注 `external: true`）：形状来自第三方公开实测/源码分析（mimi-remote live-capture 夹具、dsh-unstuck MIT 插件），但文件为本仓库自建、不复制第三方内容；详见 `docs/evidence/external-failed-turn-research.md`。
- 真实窗口可能从 turn 中间开始，不保证包含 `turn/start` 或 `turn/end`；消费方需容忍缺边界事件。

## 覆盖矩阵

| 分支 | 真实（本机） | 合成 / 外部依据 |
| --- | --- | --- |
| completed→succeeded | fixture-01/05、real-llm-retry | — |
| aborted→cancelled | fixture-03 | synthetic-question-aborted、synthetic-approval-outcomes(turn2) |
| error→failed | **本机 0** | synthetic-failed-turn；**external-observed-failed-turn（第三方 live-capture 实测）** |
| max-tokens/blocked→failed | **本机 0** | external-reason-kinds（DSH 0.2.1-alpha.1 源码 + 第三方收口表） |
| interrupted/forked→cancelled | **本机 0** | external-reason-kinds |
| waiting_approval（allowed-once） | fixture-02、real-multi-approval | — |
| waiting_approval（rejected/cancelled/unavailable） | **0** | synthetic-approval-outcomes |
| waiting_input（提问等待） | fixture-04、real-question-wait | synthetic-question-aborted |
| 工具报错≠失败 | fixture-01（7 次） | — |
| 子代理 depth=1 | fixture-05 | — |
| LLM 重试/attempt error | real-llm-retry | — |

## 复现与审计

```bash
cd dsh-mobile-watch
npm run special:fixtures   # 重新生成 special/（只读本机会话日志；合成样例直接生成）
npm run audit:fixtures     # 脱敏审计 → docs/evidence/fixture-audit.txt
npm test                   # 41 项契约/状态机/API 测试
```

审计要求：ASCII-only、无盘符/家目录路径、无 URL/邮箱、无 token 特征、无中文、字符串 <200 字符、无原始会话 ID/目录名、seq 连续。当前结果：11 个文件 / 344 行 / 0 违规（`docs/evidence/fixture-audit.txt`）。
