# M3 原生版代码复查（2026-11-17）

复查范围：`apps/ios/DSHWatch` 全部 Swift 源码、`apps/web/sw.js`、`packages/dsh-watch` 的 `/v1` 契约、`packages/gateway` 反代。

## 结论

发现并修复 1 个**真实缺陷**、2 个健壮性问题。

| 项 | 严重度 | 状态 |
| --- | --- | --- |
| `apps/web/sw.js` 文件被历史 PowerShell 文本操作写成乱码，`KIND_TEXT` 存在未闭合单引号，Service Worker 解析失败 | 高 | 已修复（重写为干净 UTF-8；因旧缓存可能已损坏，缓存版本提升到 `dsh-watch-v8`） |
| M3 任务详情把 `/v1/actions`、`/v1/questions` 当必需请求，旧插件返回 404 会导致整个详情打不开 | 中 | 已修复（改为可降级；失败时按空列表处理） |
| M3 审批/问答遇到 409 conflict / 410 expired 只显示“提交失败” | 低 | 已修复（显示“已被处理或已过期”，并刷新详情） |
| M3 设备被撤销（401）时只显示原始错误，不回到配对页 | 中 | 已修复（401 自动清除本机凭证并回到配对页） |
| `health` 只能看到 `devices: 0`，无法区分“从未配对”和“旧设备被撤销” | 低 | 已修复（新增 `devices_total` / `devices_revoked`） |

## 验证

- `npm test`：**73 / 73 通过**
- 全部 `.js` / `.mjs` 通过 `node --check`（含修复后的 `sw.js`）
- 新增 `tools/check-m3-api-shape.mjs`：对真实 `/v1/tasks`、`/v1/tasks/{id}`、`/v1/events`、`/v1/actions`、`/v1/questions` 采样，逐字段比对 M3 Swift `Codable` 模型的必需/可选类型
  - 实测结果：`tasks=10 events=20`，形状 **OK**
- 全仓库 UTF-8 扫描：无 U+FFFD 替换字符
- Web 资源中文完整性：`app.js` / `index.html` / `manifest` / `styles.css` 关键中文串均在

## Swift 模型与接口对照

- `TaskSnapshot`：`agent_count`/`agent_state`/`connection`/`delegation_depth` 均为非可选，接口确实恒返回（`normalize.mjs` 有默认值）
- `cost` 为可选，缺失时 UI 显示“暂无数据”（符合契约：DSH 只暴露 token）
- `ActionRecord`：`tool_name` 非可选（bridge 有 `'unknown'` 兜底）；`display_reason` 为 `{locale: string}`
- `QuestionItem.multi_select` ↔ 接口 `multi_select`（bridge `cleanQuestion` 显式输出）
- 审批/问答提交 body 与 `approval`/`questions` 桥的校验逻辑一致（`allowed-once|rejected`；`answers[].id/selected/custom`）

## 仍存在的边界（非缺陷）

- 免费签名无 `aps-environment`，M3 不能远程推送 —— 产品约束，文档已写明
- 真机安装（Sideloadly）与实机点击验证尚未执行 —— 需在 iPhone 上完成
